// Global state is now in state.js

// ---- Version management helpers for front matter ----

function getVersionFromFrontMatter(text) {
    const match = text.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    const vmatch = match[1].match(/^version:\s*(.+)$/m);
    return vmatch ? vmatch[1].trim() : null;
}

function incrementVersion(ver) {
    if (!ver) return '1.1';
    const parts = ver.split('.');
    if (parts.length === 1) {
        const major = parseInt(parts[0], 10);
        if (isNaN(major)) return '1.1';
        return major + '.1';
    }
    const major = parseInt(parts[0], 10);
    const minor = parseInt(parts[1], 10);
    if (isNaN(major)) return '1.1';
    if (isNaN(minor)) return major + '.1';
    // Roll over: when minor reaches 20, the next save bumps the major
    // and resets the minor to 0. e.g. 5.20 -> 6.0.
    if (minor >= 20) return (major + 1) + '.0';
    return major + '.' + (minor + 1);
}

function setVersionInFrontMatter(text, newVersion) {
    const fmMatch = text.match(/^(---\n)([\s\S]*?)(\n---)/);
    if (fmMatch) {
        let body = fmMatch[2];
        if (/^version:/m.test(body)) {
            body = body.replace(/^version:.*$/m, `version: ${newVersion}`);
        } else {
            body += `\nversion: ${newVersion}`;
        }
        return fmMatch[1] + body + fmMatch[3] + text.slice(fmMatch[0].length);
    }
    // No front matter — create one
    return `---\nversion: ${newVersion}\n---\n${text}`;
}

function getLastSavedFromFrontMatter(text) {
    const match = text.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    const lsMatch = match[1].match(/^last_saved:\s*(.+)$/m);
    return lsMatch ? lsMatch[1].trim() : null;
}

function setLastSavedInFrontMatter(text) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const fmMatch = text.match(/^(---\n)([\s\S]*?)(\n---)/);
    if (fmMatch) {
        let body = fmMatch[2];
        if (/^last_saved:/m.test(body)) {
            body = body.replace(/^last_saved:.*$/m, `last_saved: ${timestamp}`);
        } else {
            body += `\nlast_saved: ${timestamp}`;
        }
        return fmMatch[1] + body + fmMatch[3] + text.slice(fmMatch[0].length);
    }
    // No front matter — create one
    return `---\nlast_saved: ${timestamp}\n---\n${text}`;
}

function incrementPlanVersion(editor) {
    const text = editor.value;
    const currentVersion = getVersionFromFrontMatter(text) || '1.0';
    const newVersion = incrementVersion(currentVersion);
    let updated = setVersionInFrontMatter(text, newVersion);
    updated = setLastSavedInFrontMatter(updated);
    editor.value = updated;
    return updated;
}

/**
 * Merge duplicate special sections in plan text.
 * If a section marker (e.g. ---highlights---) appears more than once,
 * the contents are merged into a single section and duplicates removed.
 */
function mergeDuplicateSections(text) {
    if (!text) return text;

    const HIGHLIGHTS_START = '---highlights---';
    const HIGHLIGHTS_END = '---end-highlights---';
    const sections = [HIGHLIGHTS_START, '---budget---', '---benefits---',
                      '---raid log---', '---comms---', '---lessons learned---', '---baseline---',
                      '---whiteboard---', '---parking lot---', '---estimates---'];

    for (const marker of sections) {
        const firstIdx = text.indexOf(marker);
        if (firstIdx === -1) continue;
        const secondIdx = text.indexOf(marker, firstIdx + marker.length);
        if (secondIdx === -1) continue;

        // Found a duplicate — extract content from both occurrences
        // and merge into the first, removing the second
        if (marker === HIGHLIGHTS_START) {
            // Special handling: highlights have ---end-highlights--- markers
            // Extract all highlight entries from the full text using the parser
            if (typeof extractHighlightsFromText === 'function') {
                const allHighlights = [];
                let searchFrom = 0;
                let remaining = text;

                // Find all highlights sections and collect entries
                while (true) {
                    const start = remaining.indexOf(HIGHLIGHTS_START, searchFrom);
                    if (start === -1) break;
                    const afterStart = start + HIGHLIGHTS_START.length;
                    let endIdx = remaining.length;
                    const endMarker = remaining.indexOf(HIGHLIGHTS_END, afterStart);
                    const nextSection = remaining.indexOf('---budget---', afterStart);
                    const nextRaid = remaining.indexOf('---raid log---', afterStart);
                    const nextWhiteboard = remaining.indexOf('---whiteboard---', afterStart);
                    for (const ei of [endMarker, nextSection, nextRaid, nextWhiteboard]) {
                        if (ei !== -1 && ei < endIdx) endIdx = ei;
                    }
                    const sectionText = HIGHLIGHTS_START + remaining.substring(afterStart, endIdx);
                    const parsed = extractHighlightsFromText(sectionText);
                    allHighlights.push(...parsed);

                    // Remove this highlights section (including end marker)
                    let removeEnd = endIdx;
                    if (endMarker !== -1 && endMarker === endIdx) {
                        removeEnd = endMarker + HIGHLIGHTS_END.length;
                    }
                    // Also remove preceding --- separator
                    let removeStart = start;
                    const before = remaining.substring(0, removeStart);
                    const trimBefore = before.replace(/\n+---\n*$/, '');
                    remaining = trimBefore + remaining.substring(removeEnd);
                    searchFrom = trimBefore.length;
                }

                // Now re-insert the merged highlights using updatePlanHighlightsText
                if (allHighlights.length > 0 && typeof updatePlanHighlightsText === 'function') {
                    // Deduplicate by date+author+content
                    const seen = new Set();
                    const unique = [];
                    for (const h of allHighlights) {
                        const key = h.date + '|' + h.author + '|' + (h.content || '').trim();
                        if (!seen.has(key)) {
                            seen.add(key);
                            unique.push(h);
                        }
                    }
                    text = updatePlanHighlightsText(remaining, unique);
                } else {
                    text = remaining;
                }
            }
        } else {
            // For other sections: keep the first, remove the second
            // Find end of the second occurrence (next section marker or EOF)
            const afterSecond = secondIdx + marker.length;
            let endOfSecond = text.length;
            for (const other of sections) {
                if (other === marker) continue;
                const oi = text.indexOf(other, afterSecond);
                if (oi !== -1 && oi < endOfSecond) endOfSecond = oi;
            }
            // Remove the duplicate section
            text = text.substring(0, secondIdx).replace(/\n+$/, '') +
                   text.substring(endOfSecond);
        }
    }

    return text;
}

/**
 * Update the plan editor value while preserving cursor position and scroll state.
 * Use this whenever programmatically changing editor.value to prevent cursor drift.
 * Positions in text that survived the rewrite are followed to their new offsets.
 * This matters when an automatic rewrite prepends front matter: restoring the old
 * line number would put the caret inside YAML instead of after the task the user
 * just typed (#1082).
 */
function setEditorValuePreservingCursor(editor, newValue) {
    if (!editor) return;

    const oldValue = editor.value;
    if (newValue === oldValue) return;

    // Save cursor and scroll state
    const prevStart = editor.selectionStart;
    const prevEnd = editor.selectionEnd;
    const prevScrollTop = editor.scrollTop;
    const prevScrollLeft = editor.scrollLeft;

    // Find the unchanged prefix and suffix. A position in either can be mapped
    // exactly; a position inside the replaced middle is clamped to the closest
    // corresponding offset in the new middle.
    let prefixLength = 0;
    const maxPrefix = Math.min(oldValue.length, newValue.length);
    while (prefixLength < maxPrefix && oldValue[prefixLength] === newValue[prefixLength]) {
        prefixLength++;
    }

    let suffixLength = 0;
    const maxSuffix = Math.min(
        oldValue.length - prefixLength,
        newValue.length - prefixLength
    );
    while (suffixLength < maxSuffix &&
           oldValue[oldValue.length - 1 - suffixLength] === newValue[newValue.length - 1 - suffixLength]) {
        suffixLength++;
    }

    const oldSuffixStart = oldValue.length - suffixLength;
    const newSuffixStart = newValue.length - suffixLength;
    const newMiddleLength = newSuffixStart - prefixLength;
    const mapPosition = (position) => {
        if (position < prefixLength) return position;
        if (position >= oldSuffixStart) return newSuffixStart + (position - oldSuffixStart);
        return prefixLength + Math.min(position - prefixLength, newMiddleLength);
    };

    // Apply new value
    editor.value = newValue;

    editor.setSelectionRange(mapPosition(prevStart), mapPosition(prevEnd));

    // Restore scroll position (use requestAnimationFrame to ensure it takes effect after browser layout)
    requestAnimationFrame(() => {
        editor.scrollTop = prevScrollTop;
        editor.scrollLeft = prevScrollLeft;
    });
}

/**
 * Copy a DOM element as a PNG image to the clipboard using html2canvas.
 * Shows brief visual feedback on the button.
 */
/**
 * Copy a table element as a tab-separated text table to the clipboard.
 */
async function copyTableAsText(tableElement, feedbackBtn) {
    if (!tableElement) return;
    const table = tableElement.querySelector('table') || tableElement;
    const rows = table.querySelectorAll('tr');
    const lines = [];
    rows.forEach(row => {
        const cells = row.querySelectorAll('th, td');
        const values = Array.from(cells).map(c => c.textContent.trim());
        lines.push(values.join('\t'));
    });
    const text = lines.join('\n');
    try {
        await navigator.clipboard.writeText(text);
        if (feedbackBtn) {
            feedbackBtn.style.color = '#28a745';
            setTimeout(() => { feedbackBtn.style.color = ''; }, 1500);
        }
    } catch (err) {
        console.error('Clipboard writeText failed:', err);
    }
}

async function copyElementAsImage(element, feedbackBtn) {
    if (!element) return;
    try {
        if (typeof html2canvas === 'undefined') {
            console.error('html2canvas not loaded');
            return;
        }
        // Hide the copy button during capture so it doesn't appear in the image
        if (feedbackBtn) feedbackBtn.style.visibility = 'hidden';
        const canvas = await html2canvas(element, { backgroundColor: '#ffffff', scale: 3 });
        if (feedbackBtn) feedbackBtn.style.visibility = '';

        // Convert canvas to blob via Promise (keeps user gesture context)
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) return;

        try {
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
            ]);
            if (feedbackBtn) {
                feedbackBtn.style.color = '#28a745';
                setTimeout(() => { feedbackBtn.style.color = ''; }, 1500);
            }
        } catch (err) {
            console.error('Clipboard write failed, downloading instead:', err);
            // Fallback: download as PNG file
            const url = canvas.toDataURL('image/png');
            const a = document.createElement('a');
            a.href = url;
            a.download = 'screenshot.png';
            a.click();
        }
    } catch (err) {
        console.error('html2canvas error:', err);
        if (feedbackBtn) feedbackBtn.style.visibility = '';
    }
}

/**
 * Timer ID for the deferred section cleanup in closeDetailPane.
 * Tracked so openDetailPane can cancel it to avoid a race condition
 * where a stale timeout blanks a newly opened form.
 */
/**
 * Open the detail pane and show the specified section.
 * Hides all other sections within the pane.
 */
function openDetailPane(sectionId) {
    // Cancel any pending close cleanup to prevent it from blanking this section
    if (closeDetailPaneTimer) {
        clearTimeout(closeDetailPaneTimer);
        closeDetailPaneTimer = null;
    }

    const overlay = document.getElementById('detailPaneOverlay');
    const pane = document.getElementById('detailPane');

    // Hide all sections
    pane.querySelectorAll('.detail-pane-section').forEach(s => s.classList.remove('active'));

    // Show the requested section
    const section = document.getElementById(sectionId);
    if (section) {
        section.classList.add('active');
    }

    // Show overlay and slide pane in
    overlay.classList.add('active');
    pane.classList.add('open');
    document.body.classList.add('detail-pane-open');
}

/**
 * Close the detail pane and hide all sections.
 */
function closeDetailPane() {
    const overlay = document.getElementById('detailPaneOverlay');
    const pane = document.getElementById('detailPane');

    overlay.classList.remove('active');
    pane.classList.remove('open');
    document.body.classList.remove('detail-pane-open');

    // Hide all sections after transition (tracked so openDetailPane can cancel it)
    closeDetailPaneTimer = setTimeout(() => {
        pane.querySelectorAll('.detail-pane-section').forEach(s => s.classList.remove('active'));
        closeDetailPaneTimer = null;
    }, 300);
}

/**
 * Check if the detail pane is currently open.
 */
function isDetailPaneOpen() {
    const pane = document.getElementById('detailPane');
    return pane && pane.classList.contains('open');
}

/**
 * Detect whether the board (kanban) tab is currently active
 */
function isBoardViewActive() {
    const kanbanTab = document.getElementById('kanban-tab');
    return kanbanTab && kanbanTab.classList.contains('active');
}

/**
 * Get the currently active editor element (planEditor or kanbanPlanEditor)
 */
function getActiveEditor() {
    if (isBoardViewActive()) {
        return document.getElementById('kanbanPlanEditor') || document.getElementById('planEditor');
    }
    return document.getElementById('planEditor');
}

/**
 * Handle upload button click - opens upload tab from editor view,
 * or triggers direct file picker from board view
 */
function uploadPlanFile() {
    if (isBoardViewActive()) {
        // From board view, trigger a file picker directly
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.md,.txt,.xlsx,.xls';
        input.addEventListener('change', function(e) {
            if (e.target.files.length > 0) {
                const file = e.target.files[0];
                if (file.name.match(/\.(xlsx|xls)$/i)) {
                    openExcelImportWizard(file);
                } else {
                    handleBoardFileUpload(file);
                }
            }
        });
        input.click();
    } else {
        switchTab('upload');
    }
}

/**
 * Handle file upload directly into the board view editor
 */
async function handleBoardFileUpload(file) {
    if (!file.name.match(/\.(md|txt)$/i)) {
        showMessage('kanban', 'error', 'Please select a Markdown (.md) or text (.txt) file');
        return;
    }

    if (file.size > 1048576) {
        showMessage('kanban', 'error', 'File size must be less than 1MB');
        return;
    }

    try {
        clearPlanTrackingData();

        const text = await file.text();
        const kanbanEditor = document.getElementById('kanbanPlanEditor');
        const mainEditor = document.getElementById('planEditor');

        // Update both editors
        if (mainEditor) {
            mainEditor.value = text;
            mainEditor.dispatchEvent(new Event('input'));
        }
        if (kanbanEditor) {
            kanbanEditor.value = text;
            kanbanEditor.dispatchEvent(new Event('input'));
        }

        showMessage('kanban', 'success', `Loaded ${file.name} successfully`);

        // Render the plan in kanban context
        await render(text, null, false, false, false, false, 'kanban');
    } catch (error) {
        console.error('Error loading file:', error);
        showMessage('kanban', 'error', 'Failed to load file: ' + error.message);
    }
}

/**
 * NavigationController — centralised view registry for all navigation.
 *
 * Each view registers { activate, deactivate } hooks. Navigating to a view
 * calls deactivate on the current view, then activate on the target view.
 * This replaces the overlapping switchTab / switchToView / switchToProject /
 * switchToTracking / switchToResources functions with a single entry point.
 */
const NavigationController = (() => {
    const registry = {};
    let currentView = null;
    // The view that was active immediately before the current one -- set the
    // instant a navigation begins (before currentView is overwritten), so a
    // view like Backstage (#972) can record "what to return to" from inside
    // its own activate() hook, which by then only sees the new currentView.
    let previousView = null;
    let transitioning = false;
    // A navigation asked for while the fade below was still running. It is
    // remembered rather than dropped -- see navigateTo().
    let queuedView = null;

    // Duration must match the CSS animation duration for np-context-fade-out/in
    const TRANSITION_MS = 150;

    function register(viewName, hooks) {
        registry[viewName] = hooks;
    }

    /**
     * Determine the context for a view: 'portfolio', 'programme', or
     * 'project' -- the three altitudes issue #908's workspace model
     * describes (Portfolio > optional Programme > Project), not a binary
     * portfolio/project split. Getting this three-way right matters beyond
     * just the transition fade below: it's also what the ribbon's own
     * scope derivation (see ribbon-ia.js's scopeForView()) keys off of, so
     * a view that's actually at programme altitude never gets silently
     * lumped in with 'project' here. 'backstage' (#943) is a launcher/shell
     * view, not a project editing view, so it groups with 'portfolio' for
     * transition purposes.
     */
    function contextOf(viewName) {
        if (viewName === 'portfolio' || viewName === 'backstage') return 'portfolio';
        if (viewName === 'programme') return 'programme';
        return 'project';
    }

    /**
     * Check if the user prefers reduced motion.
     */
    function prefersReducedMotion() {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    /**
     * Show or hide the loading indicator for async data fetches.
     */
    function showLoadingIndicator(show) {
        const el = document.getElementById('contextLoadingIndicator');
        if (el) {
            el.classList.toggle('active', show);
        }
    }

    /**
     * Find the currently visible tab-content element.
     */
    function getActiveTabContent() {
        return document.querySelector('.tab-content.active');
    }

    /**
     * Navigate to a view. If switching between Portfolio and Project contexts,
     * a brief fade transition is applied to give visual feedback (#581 / UX-3).
     */
    function navigateTo(viewName) {
        if (!registry[viewName]) {
            console.warn('NavigationController: unknown view "' + viewName + '"');
            return;
        }
        // A context switch fades for TRANSITION_MS. A navigation asked for
        // inside that window used to be discarded outright, which is a
        // different thing from being slow: click Portfolio and then Project
        // faster than the fade, and the ribbon switched scope while the view
        // stayed on the portfolio -- permanently, because nothing ever
        // retried. The chrome said one thing and the page showed another.
        //
        // Remembering it instead makes the drop impossible without breaking
        // what the guard was for, which is re-entering mid-fade. Only the
        // last request is kept: someone who clicks three tabs in a second
        // wants the third, not an animation of all three.
        if (transitioning) {
            queuedView = viewName;
            return;
        }

        const isContextSwitch = currentView &&
            contextOf(currentView) !== contextOf(viewName);

        if (isContextSwitch && !prefersReducedMotion()) {
            performTransitionedSwitch(viewName);
        } else {
            performImmediateSwitch(viewName);
        }
    }

    /**
     * Immediate switch with no transition (same context or reduced motion).
     */
    function performImmediateSwitch(viewName) {
        if (currentView && registry[currentView] && registry[currentView].deactivate) {
            registry[currentView].deactivate();
        }
        previousView = currentView;
        currentView = viewName;
        registry[viewName].activate();
    }

    /**
     * Animated switch: fade-out current, swap content, fade-in new.
     */
    function performTransitionedSwitch(viewName) {
        transitioning = true;
        const outgoing = getActiveTabContent();

        // Phase 1: fade out current view
        if (outgoing) {
            outgoing.classList.add('np-context-fade-out');
        }

        // Show loading indicator for views that fetch async data
        const targetHasAsync = registry[viewName] && registry[viewName].async;
        if (targetHasAsync) {
            showLoadingIndicator(true);
        }

        setTimeout(() => {
            // Clean up outgoing animation class
            if (outgoing) {
                outgoing.classList.remove('np-context-fade-out');
            }

            // Perform the actual view switch
            if (currentView && registry[currentView] && registry[currentView].deactivate) {
                registry[currentView].deactivate();
            }
            previousView = currentView;
            currentView = viewName;
            registry[viewName].activate();

            // Phase 2: fade in new view
            const incoming = getActiveTabContent();
            if (incoming) {
                incoming.classList.add('np-context-fade-in');
                incoming.addEventListener('animationend', function handler() {
                    incoming.classList.remove('np-context-fade-in');
                    incoming.removeEventListener('animationend', handler);
                }, { once: true });
            }

            showLoadingIndicator(false);
            transitioning = false;

            // Run whatever was asked for mid-fade. Cleared before the call so
            // a navigation that starts another transition can queue its own.
            const pending = queuedView;
            queuedView = null;
            if (pending && pending !== currentView) navigateTo(pending);
        }, TRANSITION_MS);
    }

    function getCurrentView() {
        return currentView;
    }

    function getPreviousView() {
        return previousView;
    }

    function getRegistry() {
        return registry;
    }

    function isTransitioning() {
        return transitioning;
    }

    return { register, navigateTo, getCurrentView, getPreviousView, getRegistry, isTransitioning };
})();

// Shared helper: set a single nav tab as active, clearing all others (NAV-3)
function setActiveNavTab(navTabId) {
    document.querySelectorAll('.tabs .tab').forEach(tab => {
        tab.classList.remove('active');
        tab.setAttribute('aria-selected', 'false');
    });
    if (navTabId) {
        const navTab = document.getElementById(navTabId);
        if (navTab) {
            navTab.classList.add('active');
            navTab.setAttribute('aria-selected', 'true');
        }
    }
}

// Shared helper: activate a top-level tab-content pane by name
function activateTabContent(tabName) {
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    const tabContent = document.getElementById(tabName + '-tab');
    if (tabContent) {
        tabContent.classList.add('active');
    }
}

// Shared helper: show/hide RAID export menu items
function updateRaidExportVisibility(tabName) {
    const raidExportItems = document.querySelectorAll('.raid-export-item');
    raidExportItems.forEach(item => {
        item.style.display = tabName === 'raid' ? '' : 'none';
    });
}

// Shared helper: load RAID items from plan text if currently empty
function loadRaidItemsIfEmpty() {
    if (raidItems.length === 0) {
        try {
            const editor = document.getElementById('planEditor');
            if (editor && editor.value) {
                const items = extractRaidItemsFromPlanText(editor.value);
                if (items.length > 0) {
                    loadRaidItemsFromData(items);
                }
            }
        } catch (error) {
            console.error('Error loading RAID items on tab switch:', error);
        }
    }
}

// Shared helper: load budget items from plan text if currently empty
function loadBudgetItemsIfEmpty() {
    if (budgetItems.length === 0) {
        try {
            const editor = document.getElementById('planEditor');
            if (editor && editor.value) {
                const items = extractBudgetItemsFromPlanText(editor.value);
                if (items.length > 0) {
                    loadBudgetItemsFromData(items);
                }
            }
        } catch (error) {
            console.error('Error loading budget items on tab switch:', error);
        }
    }
}

// Shared helper: load comms items from plan text if currently empty
function loadCommsItemsIfEmpty() {
    if (commsItems.length === 0) {
        try {
            const editor = document.getElementById('planEditor');
            if (editor && editor.value) {
                const items = extractCommsItemsFromPlanText(editor.value);
                if (items.length > 0) {
                    loadCommsItemsFromData(items);
                }
            }
        } catch (error) {
            console.error('Error loading comms items on tab switch:', error);
        }
    }
}

// Shared deactivate hook: sync kanban editor state back to main if leaving kanban
function deactivateKanban() {
    const kanbanTab = document.getElementById('kanban-tab');
    if (kanbanTab && kanbanTab.classList.contains('active')) {
        syncEditorStateToMain();
    }
}

// ── Register all views with the NavigationController ──

// Output views that live inside the editor tab-content pane.
// Each activates the editor pane, switches the output sub-tab, and sets nav state.
const OUTPUT_VIEWS = {
    'project-report': 'planTab',
    'tasks': 'planTab',
    'notepad': 'planTab',
    'gantt': 'planTab',
    'calendar': 'planTab',
    'timeline': 'planTab',
    'milestones': 'planTab',
    'mindmap': 'planTab',
    'whiteboard': 'planTab',
    'stakeholders': 'planTab',
    'benefits': 'planTab',
    'highlights': 'planTab',
    'lookahead': 'planTab',
    'analysis': 'planTab',
    'resources': 'planTab',
    'timesheet': 'planTab',
    'user-workload': 'planTab',
    'resource-sheet': 'planTab',
    'evm': 'planTab',
    'forecast': 'planTab',
    'pbs': 'planTab',
    'deliverables': 'planTab',
    'product-flow': 'planTab',
    'benefits': 'planTab'
};

Object.entries(OUTPUT_VIEWS).forEach(([viewName, navTabId]) => {
    NavigationController.register(viewName, {
        activate() {
            deactivateKanban();
            activateTabContent('editor');
            switchOutputTab(viewName);
            updateRaidExportVisibility('editor');
            closeAllNavMenus();
            setActiveNavTab(navTabId);
            updatePlanSubnav(viewName);
        },
        deactivate() {}
    });
});

// Top-level tab views (not output sub-tabs)
NavigationController.register('kanban', {
    activate() {
        syncEditorStateToKanban();
        activateTabContent('kanban');
        updateRaidExportVisibility('kanban');
        closeAllNavMenus();
        setActiveNavTab('planTab');
        updatePlanSubnav('kanban');
        if (typeof syncKanbanFromEditor === 'function') {
            syncKanbanFromEditor();
        }
    },
    deactivate: deactivateKanban
});

NavigationController.register('raid', {
    activate() {
        deactivateKanban();
        activateTabContent('raid');
        updateRaidExportVisibility('raid');
        loadRaidItemsIfEmpty();
        closeAllNavMenus();
        setActiveNavTab('planTab');
        updatePlanSubnav('raid');
    },
    deactivate() {}
});

NavigationController.register('actions', {
    activate() {
        deactivateKanban();
        activateTabContent('actions');
        updateRaidExportVisibility('actions');
        closeAllNavMenus();
        setActiveNavTab('planTab');
        updatePlanSubnav('actions');
    },
    deactivate() {}
});

NavigationController.register('escalations', {
    activate() {
        deactivateKanban();
        activateTabContent('editor');
        loadRaidItemsIfEmpty();
        switchOutputTab('escalations');
        renderEscalationsView();
        updateRaidExportVisibility('escalations');
        closeAllNavMenus();
        setActiveNavTab('planTab');
        updatePlanSubnav('escalations');
    },
    deactivate() {}
});

NavigationController.register('budget', {
    activate() {
        deactivateKanban();
        activateTabContent('budget');
        updateRaidExportVisibility('budget');
        loadBudgetItemsIfEmpty();
        closeAllNavMenus();
        setActiveNavTab('planTab');
        updatePlanSubnav('budget');
    },
    deactivate() {}
});

NavigationController.register('comms', {
    activate() {
        deactivateKanban();
        activateTabContent('comms');
        updateRaidExportVisibility('comms');
        loadCommsItemsIfEmpty();
        closeAllNavMenus();
        setActiveNavTab('planTab');
        updatePlanSubnav('comms');
    },
    deactivate() {}
});

NavigationController.register('lessons', {
    activate() {
        deactivateKanban();
        activateTabContent('lessons');
        updateRaidExportVisibility('lessons');
        if (typeof loadLessonsItemsIfEmpty === 'function') loadLessonsItemsIfEmpty();
        closeAllNavMenus();
        setActiveNavTab('planTab');
        updatePlanSubnav('lessons');
    },
    deactivate() {}
});

NavigationController.register('guide', {
    activate() {
        deactivateKanban();
        activateTabContent('guide');
        updateRaidExportVisibility('guide');
        closeAllNavMenus();
        setActiveNavTab('planTab');
        updatePlanSubnav('guide');
    },
    deactivate() {}
});

NavigationController.register('portfolio', {
    async: true,
    activate() {
        deactivateKanban();
        if (typeof saveCurrentProjectState === 'function') {
            saveCurrentProjectState();
        }
        activateTabContent('portfolio');
        updateRaidExportVisibility('portfolio');
        closeAllNavMenus();
        setActiveNavTab(null);
        // Hide the project subnav when in portfolio view
        const planSubnav = document.getElementById('planSubnav');
        if (planSubnav) planSubnav.classList.remove('visible');
        if (typeof initPortfolio === 'function') {
            initPortfolio();
        }
    },
    deactivate() {}
});

NavigationController.register('upload', {
    activate() {
        deactivateKanban();
        activateTabContent('upload');
        updateRaidExportVisibility('upload');
        closeAllNavMenus();
    },
    deactivate() {}
});

NavigationController.register('editor', {
    activate() {
        deactivateKanban();
        activateTabContent('editor');
        updateRaidExportVisibility('editor');
        closeAllNavMenus();
        setActiveNavTab('planTab');
    },
    deactivate() {}
});

// ── Public API: backward-compatible wrappers ──

// switchTab remains available for callers that use the old top-level tab name API.
// It delegates to the NavigationController.
function switchTab(tabName) {
    NavigationController.navigateTo(tabName);
}

// Initialize editor functionality when DOM is ready
window.addEventListener('load', function() {
    initializeEditor();
    initializeKanbanEditor();
    if (typeof FrontMatterPanel !== 'undefined') FrontMatterPanel.init();
    if (typeof BackMatterPanel !== 'undefined') BackMatterPanel.init();
    initializeUploadTab();
    initializeEditorDragDrop();
    initializeKanbanEditorDragDrop();
    // The whole window accepts dropped files as imports (issue #811)
    if (typeof initializeWindowDropImport === 'function') initializeWindowDropImport();
    if (typeof EditorUndoManager !== 'undefined') {
        EditorUndoManager.init();
    }
});



function handleFile(file) {
    if (!file.name.match(/\.(md|txt|xlsx|xls)$/i)) {
        showMessage('upload', 'error', 'Please select a Markdown (.md), text (.txt), or Excel (.xlsx) file');
        return;
    }

    if (file.size > 1048576) {
        showMessage('upload', 'error', 'File size must be less than 1MB');
        return;
    }

    // Excel files go through the import wizard
    if (file.name.match(/\.(xlsx|xls)$/i)) {
        openExcelImportWizard(file);
        return;
    }

    selectedFile = file;
    uploadBtn.disabled = false;
    dropZone.innerHTML = '<div class="upload-icon">✓</div><h3>' + file.name + '</h3><p>Ready to render</p>';

    const uploadProjectNameField = document.getElementById('uploadProjectName');
    if (uploadProjectNameField && !uploadProjectNameField.value) {
        const name = file.name.replace(/\.(md|txt)$/i, '').replace(/_/g, ' ');
        uploadProjectNameField.value = name;
    }
}

async function renderFile() {
    if (!selectedFile) return;

    // Clear RAID log entries and highlights BEFORE loading new plan
    clearPlanTrackingData();

    const text = await selectedFile.text();

    // Save current project before creating a new one
    saveCurrentProjectState();

    // Create a new project from the uploaded file
    const projectName = selectedFile.name.replace(/\.(md|txt|markdown)$/i, '');
    const project = createProject(projectName);
    saveProject(project.id, { planText: text });
    setCurrentProjectId(project.id);
    updateProjectBreadcrumb(project.name);

    // Populate the editor with the file content
    const editor = document.getElementById('planEditor');
    editor.value = text;

    // Update kanban editor too
    const kanbanEditor = document.getElementById('kanbanPlanEditor');
    if (kanbanEditor) {
        kanbanEditor.value = text;
    }

    // Switch to the editor tab
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    const editorTab = document.querySelector('[onclick*="editor"]');
    if (editorTab) editorTab.classList.add('active');
    document.getElementById('editor-tab').classList.add('active');

    // Trigger input event to update line numbers and syntax highlighting
    editor.dispatchEvent(new Event('input'));

    // Refresh project selectors
    if (typeof refreshProjectSelectors === 'function') {
        refreshProjectSelectors();
    }

    // Render the plan
    await renderText();
}

async function renderText() {
    const text = document.getElementById('planEditor').value.trim();

    if (!text) {
        const output = document.getElementById('editorOutput');
        if (output) {
            output.textContent = 'Press Enter in the editor to render your plan...';
            output.classList.add('empty');
        }
        return;
    }

    // Pass current project name so render and updateAllViews have full context
    let projectName = null;
    if (typeof getCurrentProjectId === 'function' && typeof loadProject === 'function') {
        const project = loadProject(getCurrentProjectId());
        if (project) projectName = project.name;
    }

    await render(text, projectName, false, false, false, false, 'editor');
}

async function renderPlan() {
    return renderText();
}

/**
 * True when the user has opted back into the server-side PDF and Word
 * exports (localStorage np-server-exports=1): the fallback kept while the
 * browser-side exports are confirmed to match them (issue #792).
 */
function useServerExports() {
    try {
        return localStorage.getItem('np-server-exports') === '1';
    } catch (e) {
        return false;
    }
}

async function exportFile(format, prefix) {
    const text = document.getElementById('planEditor').value.trim();

    if (!text) {
        showMessage('editor', 'error', 'Please enter a plan to export');
        return;
    }

    // Close the nav menu
    closeAllNavMenus();

    // Set export flags based on format
    const exportExcel = format === 'excel';
    const exportCSV = format === 'csv';
    const exportPPT = format === 'ppt';
    const exportPDF = format === 'pdf';
    const exportMSProject = format === 'msproject';
    const exportMPP = format === 'mpp';

    // Native .mpp is built entirely in the browser from the plan the page has
    // already had scheduled. The only request is for the template asset the
    // deployment serves; there is no server-side path (issue #770).
    if (exportMPP) {
        try {
            const parse = await currentParseResult(text);
            const { exportMppInBrowser } = await import('/static/mpp-export.js');
            const { filename, warnings } = await exportMppInBrowser(parse, parse.project_name || null);
            const note = warnings.length
                ? ' (' + warnings.length + ' scheduling note' + (warnings.length === 1 ? '' : 's') + ' in the browser console)'
                : '';
            showMessage('editor', 'success', 'Exported ' + filename + note);
        } catch (error) {
            showMessage('editor', 'error', 'MS Project (.mpp) export failed: ' + error.message);
        }
        return;
    }

    if ((exportExcel || exportCSV) && browserExcelExportsEnabled()) {
        try {
            // Auto-render stale changes instead of asking the user to do it
            // first (issue #1120) -- only show the progress note when a
            // render is actually about to happen.
            const needsRender = !lastParseResult || lastParseResult.planText.trim() !== text.trim();
            if (needsRender) {
                showMessage(prefix, 'info', 'Rendering the latest plan changes…');
            }
            const parse = await currentParseResult(text);
            const projectName = parse.project_name || null;
            const module = await import('/static/browser-excel.js');
            if (exportExcel) {
                const result = await module.exportPlanExcelInBrowser(parse, {
                    projectName,
                    budgetItems,
                    filename: (projectName || 'Project') + '.xlsx'
                });
                showMessage(prefix, 'success', 'Exported ' + result.filename + ' in the browser (' + result.elapsedMs + ' ms; server CPU 0 ms).');
            } else {
                const result = await module.exportPlanCsvInBrowser(parse, { projectName, filename: (projectName || 'Project') + '.csv' });
                showMessage(prefix, 'success', 'Exported ' + result.filename + ' in the browser (' + result.elapsedMs + ' ms; server CPU 0 ms).');
            }
            return;
        } catch (error) {
            console.error('Browser Excel/CSV export failed, falling back to backend:', error);
        }
    }

    // The PDF is built in the browser too, from the same scheduled plan; the
    // only request is for the font it embeds (issue #792). The server route
    // stays available behind localStorage np-server-exports=1.
    if (exportPDF && !useServerExports()) {
        try {
            const parse = await currentParseResult(text);
            const { exportPdfInBrowser } = await import('/static/pdf-export.js');
            const { filename, warnings } = await exportPdfInBrowser(parse, text);
            const note = warnings.length
                ? ' (' + warnings.length + ' font note' + (warnings.length === 1 ? '' : 's') + ' in the browser console)'
                : '';
            showMessage('editor', 'success', 'Exported ' + filename + note);
        } catch (error) {
            showMessage('editor', 'error', 'PDF export failed: ' + error.message);
        }
        return;
    }

    await render(text, null, exportExcel, exportCSV, exportPPT, exportPDF, prefix, exportMSProject);
}

/**
 * The /api/parse result for this plan text: the last render when it was for
 * the same text, otherwise a fresh render first. Used by exports that build
 * their file in the browser instead of asking the server again.
 */
async function currentParseResult(planText) {
    if (!lastParseResult || lastParseResult.planText.trim() !== planText.trim()) {
        await renderText();
    }
    if (!lastParseResult || !lastParseResult.result || !lastParseResult.result.success) {
        throw new Error('the plan could not be scheduled; fix the errors shown in the editor and try again');
    }
    return lastParseResult.result;
}

/**
 * Excel and CSV are built in the browser by default (issue #790): the plan
 * never leaves the machine and the server spends no CPU on an export. The
 * server exporters remain one flag away, shared with the PDF and Word
 * exports — localStorage np-server-exports=1 (see useServerExports).
 */
function browserExcelExportsEnabled() {
    try {
        return !useServerExports();
    } catch (_error) {
        return false;
    }
}

/**
 * Collect data from the rendered Project Report view and export to PowerPoint.
 * This sends the currently displayed report data to the backend which generates
 * a single-slide PPTX matching the report layout.
 */
async function exportReportPptx() {
    // Close the nav menu
    closeAllNavMenus();

    // Check that the report content is visible
    const content = document.querySelector('#project-report-view .project-report-content');
    if (!content || content.style.display === 'none') {
        showMessage('editor', 'error', 'Please render a plan first before exporting the report.');
        return;
    }

    // Collect header data
    const projectName = (document.getElementById('reportProjectTitle') || {}).textContent || 'Project';

    const managerEl = document.getElementById('reportManager');
    const managerDetail = document.getElementById('reportManagerDetail');
    const manager = (managerDetail && managerDetail.style.display !== 'none' && managerEl)
        ? managerEl.textContent : '';

    const sponsorEl = document.getElementById('reportSponsor');
    const sponsorDetail = document.getElementById('reportSponsorDetail');
    const sponsor = (sponsorDetail && sponsorDetail.style.display !== 'none' && sponsorEl)
        ? sponsorEl.textContent : '';

    const budgetEl = document.getElementById('reportBudget');
    const budgetDetail = document.getElementById('reportBudgetDetail');
    const budget = (budgetDetail && budgetDetail.style.display !== 'none' && budgetEl)
        ? budgetEl.textContent : '';

    const statusEl = document.getElementById('reportStatus');
    const statusDetail = document.getElementById('reportStatusDetail');
    let status = '';
    if (statusDetail && statusDetail.style.display !== 'none' && statusEl) {
        const badge = statusEl.querySelector('.report-rag-badge');
        status = badge ? badge.textContent : statusEl.textContent;
    }

    // Fall back to the computed overall RAG status if no explicit status was set
    if (!status) {
        const overallRAGEl = document.getElementById('reportOverallRAG');
        if (overallRAGEl && overallRAGEl.style.display !== 'none') {
            status = overallRAGEl.textContent.trim();
        }
    }

    const dateEl = document.getElementById('reportDate');
    const reportDate = dateEl ? dateEl.textContent : new Date().toISOString().split('T')[0];

    // Collect milestones from the table
    const milestones = [];
    const msRows = document.querySelectorAll('#reportMilestonesTableBody tr');
    msRows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 3) {
            milestones.push({
                name: cells[0].textContent.trim(),
                date: cells[1].textContent.trim(),
                rag: cells[2].textContent.trim()
            });
        }
    });

    // Collect up next from the table
    const upNext = [];
    const unRows = document.querySelectorAll('#reportUpNextTableBody tr');
    unRows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 4) {
            upNext.push({
                name: cells[0].textContent.trim(),
                start: cells[1].textContent.trim(),
                finish: cells[2].textContent.trim(),
                rag: cells[3].textContent.trim()
            });
        }
    });

    // Collect latest highlight from the data model (not the DOM) to preserve
    // newlines and bullet formatting for the PPTX export.
    let highlight = null;
    if (highlightsData && highlightsData.length > 0) {
        const latest = highlightsData.reduce((newest, current) => {
            if (!newest) return current;
            return current.date > newest.date ? current : newest;
        }, null);
        if (latest) {
            highlight = {
                date: latest.date || null,
                author: latest.author || null,
                content: latest.content || null
            };
        }
    }

    // Collect risks & issues from RAID items (open risks and issues, sorted by score)
    const risksIssues = raidItems
        .filter(item => (item.type === 'risk' || item.type === 'issue') && item.status === 'open')
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 10)
        .map(item => ({
            type: item.type,
            title: item.title || item.description || '',
            description: item.description || '',
            mitigation: item.mitigation_actions || '',
            score: item.score || 0
        }));

    // Capture the report swimlane timeline as a PNG image using html2canvas
    let timelineImageB64 = null;
    const timelineWrapper = document.querySelector('.report-timeline-wrapper');
    if (timelineWrapper && typeof html2canvas !== 'undefined') {
        try {
            const canvas = await html2canvas(timelineWrapper, { backgroundColor: '#ffffff', scale: 2 });
            const dataUrl = canvas.toDataURL('image/png');
            timelineImageB64 = dataUrl.split(',')[1] || null;
        } catch (err) {
            console.warn('Could not capture timeline as image:', err);
        }
    }

    // Build request payload
    const payload = {
        project_name: projectName,
        manager: manager,
        sponsor: sponsor,
        budget: budget,
        date: reportDate,
        status: status,
        milestones: milestones,
        up_next: upNext,
        highlight: highlight,
        risks_issues: risksIssues,
        timeline_image: timelineImageB64
    };

    // The deck is built in the browser from this payload; nothing is sent to
    // the server (issue #791). np-server-exports=1 keeps the server route.
    if (!useServerExports()) {
        try {
            const { exportReportPptxInBrowser } = await import('/static/pptx-export.js');
            const { filename } = await exportReportPptxInBrowser(payload);
            showMessage('editor', 'success', 'Exported ' + filename);
        } catch (error) {
            console.error('Browser PowerPoint export failed:', error);
            showMessage('editor', 'error', 'Failed to export report: ' + error.message);
        }
        return;
    }

    try {
        const response = await fetch('/api/export-report-pptx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Export failed');
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const today = new Date();
        const dd = String(today.getDate()).padStart(2, '0');
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const yyyy = today.getFullYear();
        a.download = projectName + ' - Report - ' + dd + '-' + mm + '-' + yyyy + '.pptx';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();

        showMessage('editor', 'success', 'Report exported to PowerPoint successfully!');
    } catch (error) {
        console.error('Error exporting report to PowerPoint:', error);
        showMessage('editor', 'error', 'Failed to export report: ' + error.message);
    }
}

async function render(planText, projectName, exportExcel, exportCSV, exportPPT, exportPDF, prefix, exportMSProject) {
    // Capture generation so we can bail out if the user switched projects
    // while waiting for the /render response.
    const generation = (typeof projectSwitchGeneration !== 'undefined') ? projectSwitchGeneration : -1;

    const btn = document.getElementById(prefix + 'Btn');
    const spinner = document.getElementById(prefix + 'Spinner');
    const message = document.getElementById(prefix + 'Message');
    const output = document.getElementById(prefix + 'Output');

    if (btn) btn.disabled = true;
    if (spinner) spinner.style.display = 'block';
    if (message) message.style.display = 'none';
    if (output) output.classList.remove('empty');

    try {
        const data = {
            plan_text: planText,
            project_name: projectName || null,
            export_excel: exportExcel,
            export_csv: exportCSV,
            export_ppt: exportPPT,
            export_pdf: exportPDF,
            export_msproject: exportMSProject || false
        };

        const response = await fetch('/render', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        // If the user switched projects while we were waiting, discard
        // this stale response to avoid overwriting the new project.
        if (generation !== -1 && typeof projectSwitchGeneration !== 'undefined' && projectSwitchGeneration !== generation) {
            console.log('Discarding stale render response (generation', generation, '!=', projectSwitchGeneration + ')');
            return;
        }

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Rendering failed');
        }

        const contentType = response.headers.get('content-type');

        if (contentType.includes('application/json')) {
            // ASCII output
            const result = await response.json();
            if (output) output.textContent = result.ascii_output;
            // No success message needed - silent render

            // Parse plan data and update all views
            await updateAllViews(planText, projectName);
        } else {
            // Download file (ZIP, Excel, PowerPoint, or PDF)
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            // Use filename from Content-Disposition header (includes version)
            const disposition = response.headers.get('content-disposition');
            const filenameMatch = disposition && disposition.match(/filename="([^"]+)"/);
            if (filenameMatch) {
                a.download = filenameMatch[1];
            } else {
                // Fallback: determine filename from content type
                let filename = projectName || 'project';
                if (contentType.includes('application/zip')) {
                    a.download = filename + '-exports.zip';
                } else if (contentType.includes('spreadsheetml.sheet')) {
                    a.download = filename + '.xlsx';
                } else if (contentType.includes('presentationml.presentation')) {
                    a.download = filename + '-timeline.pptx';
                } else if (contentType.includes('application/pdf')) {
                    a.download = filename + '.pdf';
                } else if (contentType.includes('application/xml')) {
                    a.download = filename + '.xml';
                } else {
                    a.download = filename + '-export';
                }
            }

            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            showMessage(prefix, 'success', 'File downloaded successfully!');
        }
    } catch (error) {
        showMessage(prefix, 'error', error.message);
        if (output) output.textContent = 'Error: ' + error.message;
        // Even when the render fails, try to extract and display highlights
        // from the plan text so the highlights tab is still populated.
        try {
            updateHighlightsView(extractHighlightsFromText(planText));
        } catch (e) {
            console.error('Failed to extract highlights as fallback:', e);
        }
    } finally {
        if (btn) btn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

// --- Per-view update functions (JS-6 refactor, issue #567) ---
// Each function updates a single view and can be called independently.
// They accept a parsed result object (from /api/parse) and/or planText.

function updateHighlightsFromResult(result, planText) {
    const highlights = (result.highlights && result.highlights.length > 0)
        ? result.highlights
        : extractHighlightsFromText(planText);
    updateHighlightsView(highlights);
}

function updateGlobalState(result, planText) {
    globalResourceMap = result.resource_map || {};
    globalResourceDetails = parseResourceDetails(planText);
    lastRenderedTasks = result.tasks || [];
    // The native .mpp exporter builds from the last parse rather than asking
    // the server again, so the plan text it belongs to is kept alongside it.
    lastParseResult = { result: result, planText: planText };
    window._lastStakeholders = result.stakeholders || [];

    // The guided wizard's Scheduling stage reports on this parse's output
    // (#1054), so it has to be redrawn whenever the plan is re-scheduled --
    // otherwise a deadline the user just entered is checked against the
    // previous schedule. A no-op unless the wizard is open on that stage.
    if (typeof PlanWizard !== 'undefined' && PlanWizard.refreshStageContent) {
        PlanWizard.refreshStageContent();
    }
}

function updateMilestonesView(result) {
    updateMilestonesTable(result.tasks || []);
}

function updateReportView(result) {
    updateReportPage(result.tasks || [], result.project_name, result.front_matter || {});
}

function updateResourcesView(result) {
    updateResourcesTable(result.tasks || []);
}

function updateTimesheetView(result) {
    updateTimesheet(result.tasks || [], result.front_matter || {});
}

function updateTimelineView(result) {
    updateTimeline(result.tasks || [], result.project_name);
}

function updateEmbeddedTimelinesView() {
    updateAllEmbeddedTimelines();
}

function updateConditionalFormattingView() {
    loadConditionalFormattingRulesFromFrontMatter();
}

function updateAnimationsView() {
    checkAnimationsFrontMatter();
}

function updateGanttView(result) {
    updateGantt(result.tasks || []);
}

function updateTasksView(result) {
    updateTasksTable(result.tasks || []);
}

function updateAnalysisView(result, planText) {
    updateAnalysis(planText, result.tasks || [], planText, result.resource_map || {});
}

function updateLookAheadView(result) {
    updateLookAhead(result.tasks || []);
}

function updateUserWorkloadView(result) {
    updateUserWorkload(result.tasks || []);
}

function updateResourceSheetView(result) {
    updateResourceSheet(result.tasks || [], result.front_matter || {});
}

function updateCalendarView(result) {
    updateCalendar(result.tasks || []);
}

function updateMindmapView(result) {
    if (typeof updateMindmap === 'function') {
        updateMindmap(result.tasks || [], result.project_name);
    }
}

function updatePbsView(result) {
    if (typeof updatePbs === 'function') {
        updatePbs(result.tasks || [], result.project_name);
    }
}

function updateDeliverablesView(result) {
    if (typeof updateDeliverablesMatrix === 'function') {
        updateDeliverablesMatrix(result.tasks || [], result.project_name, result.resource_map || {}, result.stakeholders || []);
    }
}

function updateProductFlowView(result) {
    if (typeof updateProductFlow === 'function') {
        updateProductFlow(result.tasks || [], result.project_name);
    }
}

function updateRaidView(result, planText) {
    const raidFromApi = result.raid_items || [];
    if (raidFromApi.length > 0) {
        loadRaidItemsFromData(raidFromApi);
    } else {
        const raidFromText = extractRaidItemsFromPlanText(planText);
        loadRaidItemsFromData(raidFromText);
    }
}

function updateBudgetView(planText) {
    const budgetFromText = extractBudgetItemsFromPlanText(planText);
    loadBudgetItemsFromData(budgetFromText);
}

function updateCommsView(result, planText) {
    const commsFromApi = result.comms_items || [];
    if (commsFromApi.length > 0) {
        loadCommsItemsFromData(commsFromApi);
    } else {
        const commsFromText = extractCommsItemsFromPlanText(planText);
        loadCommsItemsFromData(commsFromText);
    }
}

function updateStakeholdersView() {
    loadStakeholdersFromPlanText();
}

function updateBaselineView(result, planText) {
    const baselineFromApi = result.baseline_items || [];
    if (baselineFromApi.length > 0) {
        loadBaselineFromData(baselineFromApi);
    } else {
        const baselineFromText = extractBaselineFromPlanText(planText);
        loadBaselineFromData(baselineFromText);
    }

    // The /api/parse response only carries the active baseline's items, not
    // the history log (#1112) -- that's read straight from the plan text,
    // the same way the client-side fallback above already does for items.
    const hist = extractBaselineHistoryFromSectionText(extractBaselineSectionText(planText));
    baselineHistory = hist.entries;
    activeBaselineId = hist.active;
}

function updateEditorLabels(result, planText, generation) {
    if (result.updated_plan_text && result.updated_plan_text !== planText) {
        const stale = (generation !== -1 && typeof projectSwitchGeneration !== 'undefined' && projectSwitchGeneration !== generation);
        if (!stale) {
            const editor = document.getElementById('planEditor');
            if (editor) {
                setEditorValuePreservingCursor(editor, result.updated_plan_text);
                if (editor._updateLineNumbers) editor._updateLineNumbers();
            }
        }
    }
}

function syncFrontMatterTitle(result, callerProjectId) {
    if (result.front_matter && result.front_matter.title && callerProjectId) {
        const fmTitle = String(result.front_matter.title).trim();
        if (fmTitle) {
            const project = typeof loadProject === 'function' ? loadProject(callerProjectId) : null;
            if (project && project.name !== fmTitle) {
                renameProject(callerProjectId, fmTitle);
                if (typeof updateProjectBreadcrumb === 'function') {
                    updateProjectBreadcrumb(fmTitle);
                }
                if (typeof refreshProjectSelectors === 'function') {
                    refreshProjectSelectors();
                }
            }
        }
    }
}

// --- End per-view update functions ---

async function updateAllViews(planText, projectName) {
    // Capture the generation counter so we can detect if the user switched
    // projects while we were waiting for the /api/parse response.
    const generation = (typeof projectSwitchGeneration !== 'undefined') ? projectSwitchGeneration : -1;
    // Capture the project ID at call time so the front-matter title sync
    // targets the correct project even if the user switches mid-request.
    const callerProjectId = (typeof getCurrentProjectId === 'function') ? getCurrentProjectId() : null;

    try {
        const data = {
            plan_text: planText,
            project_name: projectName || null
        };

        // The browser schedules the plan itself, which removes the request
        // this function used to make on every edit (issue #793). The engine is
        // held to the same answers as the server by
        // tests/test_engine_conformance.mjs; localStorage np-local-engine "0"
        // forces the server, and any failure falls back to it anyway.
        let result = null;
        try {
            const engine = await import('/static/engine/local-parse.js');
            if (engine.useLocalEngine()) {
                const localResult = engine.localParse(planText, projectName);
                if (localResult.success) result = localResult;
                else console.warn('[engine] local scheduling failed; falling back to the server');
            }
        } catch (engineError) {
            console.warn('[engine] unavailable; using the server:', engineError);
        }

        if (!result) {
            const response = await fetch('/api/parse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                console.error('Failed to parse plan');
                // Even if the API call failed, try to extract highlights
                // from the plan text on the client side as a fallback.
                updateHighlightsView(extractHighlightsFromText(planText));
                if (typeof updateMindmap === 'function') updateMindmap([]);
                return;
            }

            result = await response.json();
        }

        // If the user switched projects while we were waiting, discard this
        // stale response so we don't overwrite the new project's data.
        if (generation !== -1 && typeof projectSwitchGeneration !== 'undefined' && projectSwitchGeneration !== generation) {
            console.log('Discarding stale updateAllViews response (generation', generation, '!=', projectSwitchGeneration + ')');
            return;
        }

        // Sync front matter title to stored project name.
        syncFrontMatterTitle(result, callerProjectId);

        // Apply theme from front matter if specified (#595)
        if (typeof applyThemeFromFrontMatter === 'function') {
            try { applyThemeFromFrontMatter(result.front_matter); } catch (e) { console.error('Theme sync error:', e); }
        }

        // Apply project settings from front matter (#700)
        if (typeof applySettingsFromFrontMatter === 'function') {
            try { applySettingsFromFrontMatter(result.front_matter); } catch (e) { console.error('Settings sync error:', e); }
        }

        // Each view update is wrapped in try/catch so one failure does not
        // prevent the remaining views from updating (JS-6, issue #567).
        const viewUpdates = [
            { name: 'highlights',              fn: () => updateHighlightsFromResult(result, planText) },
            { name: 'globalState',             fn: () => updateGlobalState(result, planText) },
            { name: 'milestones',              fn: () => updateMilestonesView(result) },
            { name: 'report',                  fn: () => updateReportView(result) },
            { name: 'resources',               fn: () => updateResourcesView(result) },
            { name: 'timesheet',               fn: () => updateTimesheetView(result) },
            { name: 'timeline',                fn: () => updateTimelineView(result) },
            { name: 'embeddedTimelines',       fn: () => updateEmbeddedTimelinesView() },
            { name: 'conditionalFormatting',   fn: () => updateConditionalFormattingView() },
            { name: 'animations',              fn: () => updateAnimationsView() },
            { name: 'gantt',                   fn: () => updateGanttView(result) },
            { name: 'tasks',                   fn: () => updateTasksView(result) },
            { name: 'analysis',                fn: () => updateAnalysisView(result, planText) },
            { name: 'lookAhead',               fn: () => updateLookAheadView(result) },
            { name: 'userWorkload',            fn: () => updateUserWorkloadView(result) },
            { name: 'resourceSheet',           fn: () => updateResourceSheetView(result) },
            { name: 'calendar',                fn: () => updateCalendarView(result) },
            { name: 'mindmap',                 fn: () => updateMindmapView(result) },
            { name: 'whiteboard',              fn: () => { if (typeof updateWhiteboardView === 'function') updateWhiteboardView(result, planText); } },
            { name: 'pbs',                     fn: () => updatePbsView(result) },
            { name: 'deliverables',            fn: () => updateDeliverablesView(result) },
            { name: 'productFlow',             fn: () => updateProductFlowView(result) },
            { name: 'benefits',                fn: () => { if (typeof updateBenefits === 'function') updateBenefits(); } },
            { name: 'raid',                    fn: () => updateRaidView(result, planText) },
            { name: 'comms',                   fn: () => updateCommsView(result, planText) },
            { name: 'lessons',                 fn: () => { if (typeof updateLessonsView === 'function') updateLessonsView(result, planText); } },
            { name: 'budget',                  fn: () => updateBudgetView(planText) },
            { name: 'stakeholders',            fn: () => updateStakeholdersView() },
            { name: 'benefits',                fn: () => { if (typeof updateBenefits === 'function') updateBenefits(); } },
            { name: 'evm',                     fn: () => updateEVM(result.tasks || []) },
            // #1114: the Forecast view shares calculateEVM()'s cached
            // evmData with the EVM view above (this entry runs right after
            // it) rather than recomputing it -- one source of truth for
            // PV/EV/AC/EAC/ETC/VAC/TCPI/schedule forecast.
            { name: 'forecast',                fn: () => updateForecastView() },
            { name: 'baseline',                fn: () => updateBaselineView(result, planText) },
            { name: 'editorLabels',            fn: () => updateEditorLabels(result, planText, generation) },
            { name: 'statusBar',               fn: () => { if (typeof updateStatusBarRAG === 'function') updateStatusBarRAG(result.front_matter, result.tasks); } },
            { name: 'localFileStatus',         fn: () => { if (typeof updateLocalFileStatusIndicator === 'function') updateLocalFileStatusIndicator(); } },
            { name: 'statusBarDeps',           fn: () => { if (typeof updateStatusBarDependencies === 'function') updateStatusBarDependencies(result.dependencies); } },
            { name: 'mppAssignmentWarning',    fn: () => { if (typeof updateMppAssignmentWarnings === 'function') updateMppAssignmentWarnings(result); } },
            // Last, so a circular-dependency warning is not overwritten by the
            // other status-bar updates above.
            { name: 'circularDependencies',    fn: () => { if (typeof updateCircularDependencyWarnings === 'function') updateCircularDependencyWarnings(result); } },
        ];

        for (const { name, fn } of viewUpdates) {
            try {
                fn();
            } catch (e) {
                console.error(`Failed to update ${name} view:`, e);
            }
        }

    } catch (error) {
        console.error('Error updating views:', error);
        // Fallback: extract highlights, RAID, budget, stakeholders from plan
        // text on the client side so those tabs are populated even when
        // parsing fails.
        const fallbacks = [
            { name: 'highlights',    fn: () => updateHighlightsView(extractHighlightsFromText(planText)) },
            { name: 'raid',          fn: () => loadRaidItemsFromData(extractRaidItemsFromPlanText(planText)) },
            { name: 'budget',        fn: () => loadBudgetItemsFromData(extractBudgetItemsFromPlanText(planText)) },
            { name: 'stakeholders',  fn: () => loadStakeholdersFromPlanText() },
            { name: 'mindmap',       fn: () => { if (typeof updateMindmap === 'function') updateMindmap([]); } },
        ];

        for (const { name, fn } of fallbacks) {
            try {
                fn();
            } catch (e) {
                console.error(`Failed to run ${name} fallback:`, e);
            }
        }
    }
}




// Helper function to parse date strings consistently as local dates
// This avoids timezone issues where YYYY-MM-DD is parsed as UTC
function showMessage(prefix, type, text) {
    const message = document.getElementById(prefix + 'Message');
    message.className = 'message ' + type;
    message.textContent = text;
    message.style.display = 'block';

    if (type === 'success') {
        setTimeout(() => {
            message.style.display = 'none';
        }, 5000);
    }
}

/**
 * Save the active plan (Ctrl+S and the toolbar 💾 button).
 *
 * issue #767: when the current project was opened from disk via the File
 * System Access API (openLocalPlanFile below), this writes straight back to
 * that same file with no dialog and no re-prompt — LocalFileAccess retains
 * the file handle. Otherwise (Firefox/Safari, or a project never linked to a
 * file) this falls back to the original download-a-copy flow, unchanged,
 * and says so explicitly so the user knows they need to replace the file
 * themselves.
 */
async function downloadMarkdown() {
    const editor = getActiveEditor();
    const content = editor.value;
    const messageTarget = isBoardViewActive() ? 'kanban' : 'editor';

    if (!content.trim()) {
        showMessage(messageTarget, 'error', 'Nothing to save - editor is empty');
        return;
    }

    // Increment version in front matter before saving — same for both the
    // disk-linked path and the download fallback.
    const versionedContent = incrementPlanVersion(editor);

    // Persist the version bump to project storage and sync editors
    const kanbanEditor = document.getElementById('kanbanPlanEditor');
    if (kanbanEditor) kanbanEditor.value = versionedContent;
    if (typeof saveCurrentProjectState === 'function') saveCurrentProjectState();
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    const currentProjectId = typeof getCurrentProjectId === 'function' ? getCurrentProjectId() : null;
    if (typeof LocalFileAccess !== 'undefined' && currentProjectId && LocalFileAccess.isLinked(currentProjectId)) {
        const result = await LocalFileAccess.saveToLinkedFile(currentProjectId, versionedContent);
        if (result && result.ok) {
            if (typeof updateLocalFileStatusIndicator === 'function') updateLocalFileStatusIndicator();
            showMessage(messageTarget, 'success', 'Saved to ' + result.filename + ' on disk');
            return;
        }
        if (result && !result.ok) {
            // The link was dropped by saveToLinkedFile; fall through to the
            // download fallback below so the edit is not lost, but tell the
            // user their file on disk was NOT updated.
            if (typeof updateLocalFileStatusIndicator === 'function') updateLocalFileStatusIndicator();
            console.error('Could not write to linked file:', result.error);
            if (typeof showToast === 'function') {
                showToast('Could not save to ' + result.filename + ' — downloading a copy instead', 'error');
            }
        }
    }

    // Fallback: download a copy (Firefox/Safari, or no file linked)
    const blob = new Blob([versionedContent], { type: 'text/markdown' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    // Use project name + version for filename, falling back to timestamp
    const currentProject = typeof getCurrentProject === 'function' ? getCurrentProject() : null;
    const version = getVersionFromFrontMatter(versionedContent);
    if (currentProject && currentProject.name) {
        const safeName = currentProject.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        a.download = version ? `${safeName}_plan_v${version}.md` : `${safeName}.md`;
    } else {
        const now = new Date();
        const timestamp = now.toISOString().slice(0, 19).replace(/:/g, '-').replace('T', '_');
        a.download = `plan_${timestamp}.md`;
    }

    // Trigger download
    document.body.appendChild(a);
    a.click();

    // Cleanup
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    const fallbackNote = (typeof LocalFileAccess !== 'undefined' && !LocalFileAccess.isSupported())
        ? ' — replace the file on disk yourself' : '';
    showMessage(messageTarget, 'success', 'Markdown file downloaded!' + fallbackNote);
}

/**
 * Open a plan from the user's real filesystem (issue #767).
 *
 * On Chromium/Edge this uses the File System Access API and retains the
 * file handle, so later saves of this project write straight back to the
 * same file with no re-prompt (see downloadMarkdown() above). Everywhere
 * else there is no handle to keep, so this falls back to the existing
 * upload flow — opening still works, but saving stays a download-a-copy
 * operation, and the status bar makes that explicit
 * (updateLocalFileStatusIndicator).
 *
 * A file opened this way still gets a normal project entry via
 * createProject/saveProject, so every other view — which reads from
 * in-memory project state, not the file — keeps working exactly as it does
 * for any other project. The linked file on disk becomes the save target in
 * addition to that localStorage/IndexedDB entry, not instead of it.
 */
async function openLocalPlanFile() {
    if (typeof LocalFileAccess === 'undefined' || !LocalFileAccess.isSupported()) {
        if (typeof showToast === 'function') {
            showToast('This browser can’t link Save to a file on disk — use Upload, then Save to download a copy to replace it.', 'info');
        }
        uploadPlanFile();
        return;
    }

    let picked;
    try {
        picked = await LocalFileAccess.pickAndReadFile();
    } catch (error) {
        console.error('Error opening local file:', error);
        showMessage(isBoardViewActive() ? 'kanban' : 'editor', 'error', 'Failed to open file: ' + error.message);
        return;
    }
    if (!picked) return; // user cancelled the picker

    clearPlanTrackingData();

    // Save whatever project is currently open before switching away from it.
    if (typeof saveCurrentProjectState === 'function') saveCurrentProjectState();

    const boardView = isBoardViewActive();
    const projectName = picked.name.replace(/\.(md|markdown)$/i, '');
    const project = createProject(projectName);
    saveProject(project.id, { planText: picked.text });
    setCurrentProjectId(project.id);
    LocalFileAccess.link(project.id, picked.handle, picked.name);
    if (typeof updateProjectBreadcrumb === 'function') updateProjectBreadcrumb(project.name);

    const editor = document.getElementById('planEditor');
    if (editor) editor.value = picked.text;
    const kanbanEditor = document.getElementById('kanbanPlanEditor');
    if (kanbanEditor) kanbanEditor.value = picked.text;

    if (!boardView) {
        // Switch to the editor tab (mirrors renderFile())
        document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        const editorTab = document.querySelector('[onclick*="editor"]');
        if (editorTab) editorTab.classList.add('active');
        const editorTabContent = document.getElementById('editor-tab');
        if (editorTabContent) editorTabContent.classList.add('active');
    }

    const activeEditor = boardView ? (kanbanEditor || editor) : editor;
    if (activeEditor) activeEditor.dispatchEvent(new Event('input'));

    if (typeof refreshProjectSelectors === 'function') refreshProjectSelectors();
    if (typeof updateLocalFileStatusIndicator === 'function') updateLocalFileStatusIndicator();

    const messageTarget = boardView ? 'kanban' : 'editor';
    showMessage(messageTarget, 'success', 'Opened ' + picked.name + ' — linked for saving');

    if (boardView) {
        // Stay on the board, same as handleBoardFileUpload()
        await render(picked.text, null, false, false, false, false, 'kanban');
    } else {
        await renderText();
    }
}

/**
 * Reflect whether the current project is linked to a file on disk in the
 * status bar (issue #767) — which Save behaviour is in effect should always
 * be visible, not something the user discovers by watching for a dialog
 * that never appears (or unexpectedly does).
 */
function updateLocalFileStatusIndicator() {
    const el = document.getElementById('localFileLinkStatus');
    if (!el) return;
    const projectId = typeof getCurrentProjectId === 'function' ? getCurrentProjectId() : null;
    if (typeof LocalFileAccess !== 'undefined' && projectId && LocalFileAccess.isLinked(projectId)) {
        const name = LocalFileAccess.getLinkedFileName(projectId);
        el.textContent = '🔗 ' + name;
        el.title = 'Saves write straight back to ' + name + ' on disk — no download, no re-prompt';
    } else {
        el.textContent = '';
        el.title = '';
    }
}

// Task Form Modal Functions
// Task form state is now in state.js

// Task class to manage task state
class Task {
    constructor(lineNumber, lineText) {
        this.lineNumber = lineNumber;
        this.originalLine = lineText || '';
        this.indent = this.extractIndent(lineText);
        this.name = '';
        this.duration = '';
        this.startDate = '';
        this.finishDate = '';
        this.percent = 0;
        this.resources = [];
        this.comment = '';
        this.priority = 'Low';
        this.bucket = '';
        this.dependencies = [];
        this.labels = [];
        this.dependsOnPrevious = false;

        // Parse the line if provided
        if (lineText) {
            this.parseFromLine(lineText);
        }
    }

    extractIndent(line) {
        if (!line) return '';
        const match = line.match(/^(\\s*)/);
        return match ? match[1] : '';
    }

    parseFromLine(line) {
        const trimmed = line.trim();
        if (!trimmed) return;

        let remaining = trimmed;

        // Check for * prefix (depends on previous task)
        if (remaining.startsWith('*')) {
            this.dependsOnPrevious = true;
            remaining = remaining.substring(1).trim();
        }

        // Extract task name - stop at first: duration, @, #, %, ", or RAG
        const nameMatch = remaining.match(/^([^\\d@#%"]+?)(?=\\s+\\d+d|\\s+@|\\s+#|\\s+\\d+%|\\s+"|$)/);
        if (nameMatch) {
            this.name = nameMatch[1].trim();
        }

        // Extract duration (e.g., "5d")
        const durationMatch = remaining.match(/\\b(\\d+)d\\b/);
        if (durationMatch) {
            this.duration = durationMatch[1];
        }

        // Extract percent (e.g., "50%")
        const percentMatch = remaining.match(/\\b(\\d+)%\\b/);
        if (percentMatch) {
            this.percent = parseInt(percentMatch[1]);
        }

        // Extract resources (all @mentions)
        const resourceMatches = remaining.match(/@([^\\s@#%!"]+)/g);
        if (resourceMatches) {
            this.resources = resourceMatches.map(r => r.substring(1));
        }

        // Extract labels/tags (after #)
        const labelMatches = remaining.match(/#([^\\s@%!"]+)/g);
        if (labelMatches) {
            this.labels = labelMatches.map(l => l.substring(1));
        }

        // Extract comment (text in quotes)
        const commentMatch = remaining.match(/"([^"]*)"/);
        if (commentMatch) {
            this.comment = commentMatch[1];
        }

        // Extract bucket (text in curly braces)
        const bucketMatch = remaining.match(/\{([^}]+)\}/);
        if (bucketMatch) {
            this.bucket = bucketMatch[1].trim();
        }

        // Extract priority markers
        const priorityMatch = remaining.match(/(?<!\w)(!!!|!!|!)(?!["'{])/);
        if (priorityMatch) {
            const marker = priorityMatch[1];
            if (marker === '!!!') this.priority = 'Urgent';
            else if (marker === '!!') this.priority = 'Important';
            else if (marker === '!') this.priority = 'Medium';
        }
    }

    // Calculate duration from dates
    calculateDurationFromDates() {
        if (!this.startDate || !this.finishDate) return null;
        const start = new Date(this.startDate);
        const finish = new Date(this.finishDate);
        const diffTime = Math.abs(finish - start);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    }

    // Calculate finish date from start + duration
    calculateFinishDateFromDuration() {
        if (!this.startDate || !this.duration) return null;
        const start = new Date(this.startDate);
        const durationDays = parseInt(this.duration);
        if (isNaN(durationDays)) return null;
        const finish = new Date(start);
        finish.setDate(finish.getDate() + durationDays);
        return finish.toISOString().split('T')[0];
    }

    // Reconstruct task line from current state
    toString() {
        let line = this.indent;

        // Add * prefix if depends on previous
        if (this.dependsOnPrevious) {
            line += '*';
        }

        // Add task name
        line += this.name;

        // Add duration
        if (this.duration) {
            line += ' ' + this.duration + 'd';
        }

        // Add resources
        if (this.resources.length > 0) {
            line += ' ' + this.resources.map(r => '@' + r).join(' ');
        }

        // Add dependencies using [depends] syntax
        const nonPrevDeps = this.dependencies.filter(d => {
            // Get previous task name to filter it out
            const editor = document.getElementById('planEditor');
            if (editor) {
                const lines = editor.value.split('\n');
                const prevName = this.getPreviousTaskName(lines);
                return d !== prevName;
            }
            return true;
        });

        if (nonPrevDeps.length > 0) {
            line += ' [depends ' + nonPrevDeps.join(', ') + ']';
        }

        // Add labels
        if (this.labels.length > 0) {
            line += ' ' + this.labels.map(l => '#' + l).join(' ');
        }

        // Add percent
        if (this.percent > 0) {
            line += ' ' + this.percent + '%';
        }

        // Add priority marker
        const priorityMarkers = { 'Urgent': '!!!', 'Important': '!!', 'Medium': '!' };
        if (priorityMarkers[this.priority]) {
            line += ' ' + priorityMarkers[this.priority];
        }

        // Add bucket
        if (this.bucket) {
            line += ' {' + this.bucket + '}';
        }

        // Add comment
        if (this.comment) {
            line += ' "' + this.comment + '"';
        }

        return line;
    }

    getPreviousTaskName(lines) {
        // Find the previous non-empty, non-summary task line
        for (let i = this.lineNumber - 2; i >= 0; i--) {
            const line = lines[i].trim();
            if (line && !line.includes('===') && !line.includes('---') && !line.startsWith('#')) {
                // Skip summary tasks (phases that have children)
                if (typeof isSummaryLine === 'function' && isSummaryLine(lines, i)) continue;

                // Extract task name
                let taskLine = line;
                if (taskLine.startsWith('*')) {
                    taskLine = taskLine.substring(1).trim();
                }
                const nameMatch = taskLine.match(/^([^\\d@#%"]+?)(?=\\s+\\d+d|\\s+@|\\s+#|\\s+\\d+%|\\s+"|$)/);
                if (nameMatch) {
                    return nameMatch[1].trim();
                }
            }
        }
        return null;
    }

    // Update task in editor
    updateInEditor() {
        const editor = document.getElementById('planEditor');
        if (!editor) return;

        const lines = editor.value.split('\n');
        lines[this.lineNumber - 1] = this.toString();
        editor.value = lines.join('\n');

        // Trigger render
        setTimeout(() => renderText(), 10);
    }
}

// Check if a date is a weekend (Saturday or Sunday)
function isWeekend(date) {
    const day = date.getDay();
    return day === 0 || day === 6; // Sunday=0, Saturday=6
}

// Get the next working day (skip weekends)
function getNextWorkingDay(date) {
    const result = new Date(date);
    while (isWeekend(result)) {
        result.setDate(result.getDate() + 1);
    }
    return result;
}

// Add working days to a start date, skipping weekends
// Returns the finish date (end of the last working day)
function addWorkingDays(startDate, numDays) {
    if (numDays === 0) {
        // Zero-duration tasks (milestones) finish on the same day
        return new Date(startDate);
    }

    // Ensure we start from a working day
    let current = getNextWorkingDay(new Date(startDate));
    let daysAdded = 0;

    while (daysAdded < numDays) {
        // If current day is a working day, count it
        if (!isWeekend(current)) {
            daysAdded++;
        }
        // Move to next day
        current.setDate(current.getDate() + 1);
    }

    return current;
}

// Calculate dates for a task, looking up dependency dates from a task map
function calculateTaskDates(task, taskMap, lines, visited) {
    // Track visited tasks to prevent circular dependency infinite loops
    if (!visited) visited = new Set();
    if (visited.has(task.name)) return task;
    visited.add(task.name);

    // If task already has both dates, return it
    if (task.startDate && task.finishDate) {
        return task;
    }

    // Try to calculate from dependencies
    if (task.dependencies && !task.startDate) {
        const depEntries = task.dependencies.split(',').map(d => d.trim());
        let latestRefDate = null;

        for (const depEntry of depEntries) {
            // Strip lag/lead time and dependency type suffix from dependency name
            const lagLeadMatch = depEntry.match(/^(.+?)\s+[+\-]\d+[dwmy]$/);
            let corePart = lagLeadMatch ? lagLeadMatch[1].trim() : depEntry;
            const typeMatch = corePart.match(/^(.+?):(FS|SS|FF|SF)$/i);
            const depName = typeMatch ? typeMatch[1].trim() : corePart;
            const depType = typeMatch ? typeMatch[2].toUpperCase() : 'FS';

            // Look up dependency in the map
            const depTask = taskMap.get(depName);
            if (depTask) {
                // Recursively calculate dependency dates if not set
                if (!depTask.finishDate || !depTask.startDate) {
                    calculateTaskDates(depTask, taskMap, lines, visited);
                }
                // Use start date for SS/SF, finish date for FS/FF
                const refDate = (depType === 'SS' || depType === 'SF') ? depTask.startDate : depTask.finishDate;
                if (refDate) {
                    if (!latestRefDate || refDate > latestRefDate) {
                        latestRefDate = refDate;
                    }
                }
            }
        }

        // If we found a dependency reference date, use it as start date
        if (latestRefDate) {
            task.startDate = latestRefDate;
        }
    }

    // If no start date yet, default to today
    if (!task.startDate) {
        const today = new Date();
        task.startDate = today.toISOString().split('T')[0];
    }

    // Calculate finish date from start date and duration, skipping weekends
    if (!task.finishDate) {
        const duration = task.duration || '1'; // Default to 1 day if no duration
        const durationDays = parseInt(duration);
        const start = new Date(task.startDate);
        const finish = addWorkingDays(start, durationDays);
        task.finishDate = finish.toISOString().split('T')[0];
    }

    // Ensure duration is set
    if (!task.duration) {
        if (task.startDate && task.finishDate) {
            const start = new Date(task.startDate);
            const finish = new Date(task.finishDate);
            const diffDays = Math.ceil((finish - start) / (1000 * 60 * 60 * 24));
            task.duration = diffDays.toString();
        } else {
            task.duration = '1'; // Default duration
        }
    }

    return task;
}

function openTaskFormByName(taskName) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const lines = editor.value.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const t = parseTaskLine(lines[i], i + 1);
        if (t.name && t.name === taskName) {
            openTaskForm(i + 1);
            return;
        }
    }
}

/**
 * Reliably set the task form title on the contenteditable h2 element.
 *
 * Using innerText (not textContent) because some browsers do not
 * visually update contenteditable elements when textContent is changed
 * while the element is inside a hidden (display:none) container.
 * We also re-apply the title after the detail pane becomes visible to
 * guard against rendering quirks during CSS transitions.
 */
function setTaskFormTitle(title) {
    const header = document.getElementById('taskFormPanelHeader');
    if (!header) return;
    const displayTitle = title || 'Task Name';
    header.setAttribute('title', displayTitle);
}

// Flag to prevent saveTask from firing while openTaskForm is populating fields
let _taskFormPopulating = false;

function openTaskForm(lineNumber) {
    // Parse task name early so it is available for both the form title
    // and the catch-block fallback.
    let parsedTaskName = '';
    _taskFormPopulating = true;

    // Cancel any pending product form save timer that could trigger
    // a re-render and interfere with the task form opening
    if (typeof productFormSaveTimer !== 'undefined' && productFormSaveTimer) {
        clearTimeout(productFormSaveTimer);
        productFormSaveTimer = null;
    }

    // Open the detail pane FIRST so the form section becomes visible
    // (display:flex) before we populate its fields. On the very first
    // click this prevents a race where field values are set while the
    // section is display:none, which can cause browsers to skip
    // rendering updates for certain elements (e.g. contenteditable,
    // select dropdowns, date inputs). Fixes #663.
    openDetailPane('taskFormSection');

    // Force a layout reflow so the browser paints the section as visible
    // before we populate fields. Without this, some browsers may skip
    // rendering updates for fields set while transitioning.
    const taskFormEl = document.getElementById('taskFormSection');
    if (taskFormEl) void taskFormEl.offsetHeight;

    // Set the line number IMMEDIATELY — before any field values are set.
    // Setting field values can trigger oninput → saveTask(), which uses
    // currentTaskLineNumber. If we set it late, saveTask writes the new
    // task's name to the OLD task's line.
    currentTaskLineNumber = lineNumber;

    try {
        const editor = document.getElementById('planEditor');
        const lines = editor.value.split('\n');
        const taskLine = lines[lineNumber - 1];

        if (!taskLine && taskLine !== '') {
            console.error('No task line found at line number:', lineNumber);
            return;
        }

        // Parse task details from line
        const task = parseTaskLine(taskLine, lineNumber);
        parsedTaskName = task.name || '';

        // Set the task name and title immediately so they are visible
        // even if later steps (e.g. date calculation) throw an error.
        document.getElementById('taskName').value = parsedTaskName;
        setTaskFormTitle(parsedTaskName);

        // Track which fields were in the original task (user set in markdown)
        const originalStartDate = task.startDate;
        const originalFinishDate = task.finishDate;
        const originalDuration = task.duration;

        // Use backend-calculated dates from last render instead of
        // recalculating in JS (which can diverge from the scheduling engine).
        const backendTask = (lastRenderedTasks && lastRenderedTasks.length > 0)
            ? lastRenderedTasks.find(bt => bt.name === parsedTaskName)
            : null;
        if (backendTask) {
            task.startDate = backendTask.start || task.startDate;
            task.finishDate = backendTask.finish || task.finishDate;
            task.deadline = backendTask.deadline || task.deadline;
            if (backendTask.duration_days) {
                task.duration = String(backendTask.duration_days);
            }
        } else {
            // Fallback: calculate in JS if backend data not available
            const taskMap = new Map();
            for (let i = 0; i < lines.length; i++) {
                const t = parseTaskLine(lines[i], i + 1);
                if (t.name) {
                    taskMap.set(t.name, t);
                }
            }
            calculateTaskDates(task, taskMap, lines);
        }

        // Mark which fields are user-set vs auto-calculated
        userSetStartDate = !!originalStartDate;
        userSetFinishDate = !!originalFinishDate;
        userSetDuration = !!originalDuration;

        const durationField = document.getElementById('taskDuration');
        durationField.value = task.duration || '1';

        const startDateField = document.getElementById('taskStartDate');
        const finishDateField = document.getElementById('taskFinishDate');

        startDateField.value = task.startDate || '';
        finishDateField.value = task.finishDate || '';

        // Style auto-calculated fields as italic
        startDateField.style.fontStyle = userSetStartDate ? 'normal' : 'italic';
        finishDateField.style.fontStyle = userSetFinishDate ? 'normal' : 'italic';
        durationField.style.fontStyle = userSetDuration ? 'normal' : 'italic';

        // Deadline is never auto-calculated -- it's exactly what's in the
        // markdown, or blank.
        const deadlineField = document.getElementById('taskDeadline');
        deadlineField.value = task.deadline || '';
        deadlineField.style.fontStyle = 'normal';

        document.getElementById('taskPercent').value = task.percent || '';

        // Check if percent is effort-driven and style accordingly
        const effortTotal = parseFloat(task.effortTotal) || 0;
        const effortPercentInput = document.getElementById('taskPercent');
        if (effortTotal > 0 && effortPercentInput) {
            effortPercentInput.readOnly = true;
            effortPercentInput.title = 'Auto-calculated from effort (completed / total)';
            effortPercentInput.style.fontStyle = 'italic';
        } else if (effortPercentInput) {
            effortPercentInput.style.fontStyle = 'normal';
            effortPercentInput.title = '';
        }

        // Populate effort fields
        const effortCompletedInput = document.getElementById('taskEffortCompleted');
        const effortCompletedUnitSelect = document.getElementById('taskEffortCompletedUnit');
        const effortRemainingInput = document.getElementById('taskEffortRemaining');
        const effortRemainingUnitSelect = document.getElementById('taskEffortRemainingUnit');
        if (effortCompletedInput) {
            effortCompletedInput.value = (task.effortCompleted && task.effortCompleted !== '0') ? task.effortCompleted : '';
        }
        if (effortCompletedUnitSelect) {
            effortCompletedUnitSelect.value = task.effortCompletedUnit || 'h';
        }
        if (effortRemainingInput) {
            effortRemainingInput.value = task.effortRemaining || '';
        }
        if (effortRemainingUnitSelect) {
            effortRemainingUnitSelect.value = task.effortRemainingUnit || 'h';
        }
        updateEffortTotal();

        document.getElementById('taskResources').value = task.resources || '';
        document.getElementById('taskComment').value = task.comment || '';
        const prioritySelect = document.getElementById('taskPriority');
        if (prioritySelect) {
            prioritySelect.value = task.priority || 'Low';
        }
        const bucketInput = document.getElementById('taskBucket');
        if (bucketInput) {
            bucketInput.value = task.bucket || '';
        }
        populateDependenciesTable(task.dependencies || '');

        // Populate labels field if it exists
        const labelsInput = document.getElementById('taskLabels');
        if (labelsInput) {
            labelsInput.value = task.labels || '';
        }

        // Populate recurrence fields
        populateRecurrenceForm(task.recurrence || '');

        // currentTaskLineNumber already set at the top of openTaskForm
        updateRagDisplay();
        updateProgressBar();

        // Populate subtasks
        populateSubtasks(lineNumber, lines);

        // Update deliverable/product button
        try {
            const delivBtn = document.getElementById('taskDeliverableBtn');
            if (delivBtn) {
                delivBtn.style.display = '';
                if (task.deliverable) {
                    delivBtn.textContent = '\uD83D\uDCE6 Product';
                    delivBtn.title = 'Open product details';
                } else {
                    delivBtn.textContent = '\uD83D\uDCE6 Make Deliverable';
                    delivBtn.title = 'Mark this task as a deliverable';
                }
            }
        } catch (e) {
            console.warn('Error updating deliverable button:', e);
        }

        // Re-apply title after the browser has painted the now-visible pane.
        // Using requestAnimationFrame ensures layout is complete before we
        // update the contenteditable element.
        requestAnimationFrame(() => setTaskFormTitle(parsedTaskName));

        // If lastRenderedTasks was empty (first interaction before initial
        // render completes), trigger a background fetch so the next open
        // of the form will have accurate backend-calculated data.
        if (!backendTask && lastRenderedTasks.length === 0) {
            const planText = editor.value.trim();
            if (planText && typeof updateAllViews === 'function') {
                updateAllViews(planText);
            }
        }
    } catch (error) {
        console.error('Error opening task form for line', lineNumber, ':', error);
        // Ensure the title is set even when an error occurs during form population
        if (parsedTaskName) {
            document.getElementById('taskName').value = parsedTaskName;
        }
        // Re-apply title after the browser has painted
        requestAnimationFrame(() => setTaskFormTitle(parsedTaskName));
    }
    _taskFormPopulating = false;
}

/** Line number of the task currently shown in the inspector. */
let currentInspectorLineNumber = null;

/**
 * Open the task inspector for the task currently open in the task form.
 */
function openTaskInspectorFromForm() {
    if (currentTaskLineNumber) {
        openTaskInspector(currentTaskLineNumber);
    }
}

/**
 * Open the task form for the task currently shown in the inspector.
 */
function editFromInspector() {
    if (currentInspectorLineNumber) {
        closeTaskInspector();
        openTaskForm(currentInspectorLineNumber);
    }
}

function openMilestoneTaskForm(taskName) {
    // Switch to plan editor tab
    switchTab('editor');

    // Find the task in the editor by name
    const editor = document.getElementById('planEditor');
    const lines = editor.value.split('\n');

    // Search for the task by matching the name
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Skip empty lines and front matter
        if (!line || line.startsWith('---') || line.startsWith('#')) continue;

        // Parse the task name from the line
        const task = parseTaskLine(lines[i], i + 1);

        // Match task name (exact match)
        if (task.name && task.name === taskName) {
            // Found the task - open the form
            openTaskForm(i + 1);
            return;
        }
    }

    console.error('Task not found in editor:', taskName);
}

/**
 * Find the editor line number (1-based) for a task by name and level.
 */
function findTaskLineNumber(task) {
    const editor = document.getElementById('planEditor');
    if (!editor) return -1;

    if (typeof NoodlePlanModel !== 'undefined') {
        const model = NoodlePlanModel.modelForEditor(editor);
        const node = task && task._uid != null
            ? model.findById(task._uid)
            : model.findByName(task && task.name, task && task.level);
        if (node) return model.lineNumber(node);
    }

    const lines = editor.value.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const parsed = parseTaskLine(lines[i], i + 1);
        if (parsed.name && parsed.name === task.name) {
            return i + 1;
        }
    }
    return -1;
}

/**
 * Show the task context menu near the clicked button.
 */
/**
 * Open the reusable-card library popup (#1050) for `task`: save its
 * subtree as a new card, or insert a saved card after it. Shared by both
 * task context menus so the editor/getText/setText/insertAtCursor wiring
 * lives in one place.
 */
function openCardLibraryForTask(task) {
    if (typeof CardLibrary === 'undefined') return;
    const editor = document.getElementById('planEditor');
    if (!editor) return;
    CardLibrary.openCardLibraryPopup({
        getText: () => editor.value,
        setText: (text) => {
            editor.value = text;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
        },
        taskName: task.name,
        insertAtCursor: (text) => {
            const start = editor.selectionStart != null ? editor.selectionStart : editor.value.length;
            const end = editor.selectionEnd != null ? editor.selectionEnd : start;
            const before = editor.value.slice(0, start);
            const after = editor.value.slice(end);
            const insertion = (before && !before.endsWith('\n') ? '\n' : '') + text;
            editor.value = before + insertion + after;
            const caret = before.length + insertion.length;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            editor.focus();
            editor.setSelectionRange(caret, caret);
        },
    });
}

function showTaskContextMenu(event, task, taskIndex) {
    event.stopPropagation();
    event.preventDefault();

    closeTaskContextMenu();

    // Track the trigger button for aria-expanded
    const triggerBtn = event.currentTarget;
    triggerBtn.setAttribute('aria-expanded', 'true');

    const menu = document.createElement('div');
    menu.className = 'task-context-menu show';
    menu.id = 'activeTaskContextMenu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Task actions');
    menu._triggerBtn = triggerBtn;

    const items = [];

    // Edit
    items.push(createContextMenuItem('Edit', '\u270E', () => {
        openMilestoneTaskForm(task.name);
    }));

    // Inspect Task (only for non-summary tasks)
    if (!task.is_summary) {
        items.push(createContextMenuItem('Inspect Task', '\uD83D\uDD0D', () => {
            openTaskInspectorByName(task.name);
        }));
    }

    // Estimate (#1053) -- only for non-summary tasks, mirroring Inspect Task
    if (!task.is_summary && typeof EstimatingTool !== 'undefined') {
        items.push(createContextMenuItem('Estimate\u2026', '\uD83C\uDFAF', () => {
            const editor = document.getElementById('planEditor');
            if (!editor) return;
            EstimatingTool.openEstimatePopup({
                getText: () => editor.value,
                setText: (text) => {
                    editor.value = text;
                    editor.dispatchEvent(new Event('input', { bubbles: true }));
                },
                taskName: task.name,
            });
        }));
    }

    // Cards (#1050) -- save this task's subtree as a reusable card, or
    // insert a saved one after it. Available for summary tasks too (a
    // phase or a governance block is a natural card), unlike Estimate.
    if (typeof CardLibrary !== 'undefined') {
        items.push(createContextMenuItem('Snippets…', '📇', () => {
            openCardLibraryForTask(task);
        }));
    }

    items.push(createContextMenuSeparator());

    // Promote (outdent)
    items.push(createContextMenuItem('Promote (Outdent)', '\u2B05', () => {
        promoteTask(task, taskIndex);
    }));

    // Demote (indent)
    items.push(createContextMenuItem('Demote (Indent)', '\u27A1', () => {
        demoteTask(task, taskIndex);
    }));

    items.push(createContextMenuSeparator());

    // Insert Above
    items.push(createContextMenuItem('Insert Task Above', '\u2795', () => {
        insertTaskAbove(task, taskIndex);
    }));

    // Insert Below
    items.push(createContextMenuItem('Insert Task Below', '\u2795', () => {
        if (typeof insertTaskAtPosition === 'function') {
            insertTaskAtPosition(task, 'below');
        }
    }));

    // Assign Resource
    items.push(createContextMenuItem('Assign Resource', '\uD83D\uDC64', () => {
        assignResourceToTask(task, taskIndex);
    }));

    items.push(createContextMenuSeparator());

    // Set Completion (submenu)
    const completionSubmenu = createCompletionSubmenu(task, taskIndex);
    items.push(completionSubmenu);

    items.forEach(item => menu.appendChild(item));

    document.body.appendChild(menu);

    // Position menu near the button
    const btnRect = triggerBtn.getBoundingClientRect();
    let left = btnRect.right + 4;
    let top = btnRect.top;

    // Ensure menu doesn't overflow the viewport
    const menuRect = menu.getBoundingClientRect();
    if (left + menuRect.width > window.innerWidth) {
        left = btnRect.left - menuRect.width - 4;
    }
    if (top + menuRect.height > window.innerHeight) {
        top = window.innerHeight - menuRect.height - 8;
    }
    if (top < 0) top = 8;

    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    // Focus the first menu item for keyboard navigation
    const firstItem = menu.querySelector('button[role="menuitem"]');
    if (firstItem) firstItem.focus();

    // Keyboard navigation within the menu
    menu.addEventListener('keydown', handleContextMenuKeydown);

    // Close when clicking outside
    setTimeout(() => {
        document.addEventListener('click', closeTaskContextMenuOnOutsideClick);
    }, 0);
}

/**
 * Show the task context menu at a specific mouse position (for right-click).
 */
function showTaskContextMenuAtPosition(event, task, taskIndex) {
    closeTaskContextMenu();

    const menu = document.createElement('div');
    menu.className = 'task-context-menu show';
    menu.id = 'activeTaskContextMenu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Task actions');

    const items = [];

    // Edit
    items.push(createContextMenuItem('Edit', '\u270E', () => {
        openMilestoneTaskForm(task.name);
    }));

    // Inspect Task (only for non-summary tasks)
    if (!task.is_summary) {
        items.push(createContextMenuItem('Inspect Task', '\uD83D\uDD0D', () => {
            openTaskInspectorByName(task.name);
        }));
    }

    // Estimate (#1053) -- only for non-summary tasks, mirroring Inspect Task
    if (!task.is_summary && typeof EstimatingTool !== 'undefined') {
        items.push(createContextMenuItem('Estimate\u2026', '\uD83C\uDFAF', () => {
            const editor = document.getElementById('planEditor');
            if (!editor) return;
            EstimatingTool.openEstimatePopup({
                getText: () => editor.value,
                setText: (text) => {
                    editor.value = text;
                    editor.dispatchEvent(new Event('input', { bubbles: true }));
                },
                taskName: task.name,
            });
        }));
    }

    // Cards (#1050) -- save this task's subtree as a reusable card, or
    // insert a saved one after it. Available for summary tasks too (a
    // phase or a governance block is a natural card), unlike Estimate.
    if (typeof CardLibrary !== 'undefined') {
        items.push(createContextMenuItem('Snippets…', '📇', () => {
            openCardLibraryForTask(task);
        }));
    }

    items.push(createContextMenuSeparator());

    // Promote (outdent)
    items.push(createContextMenuItem('Promote (Outdent)', '\u2B05', () => {
        promoteTask(task, taskIndex);
    }));

    // Demote (indent)
    items.push(createContextMenuItem('Demote (Indent)', '\u27A1', () => {
        demoteTask(task, taskIndex);
    }));

    items.push(createContextMenuSeparator());

    // Insert Above
    items.push(createContextMenuItem('Insert Task Above', '\u2795', () => {
        insertTaskAbove(task, taskIndex);
    }));

    // Insert Below
    items.push(createContextMenuItem('Insert Task Below', '\u2795', () => {
        if (typeof insertTaskAtPosition === 'function') {
            insertTaskAtPosition(task, 'below');
        }
    }));

    // Assign Resource
    items.push(createContextMenuItem('Assign Resource', '\uD83D\uDC64', () => {
        assignResourceToTask(task, taskIndex);
    }));

    items.push(createContextMenuSeparator());

    // Set Completion (submenu)
    const completionSubmenu = createCompletionSubmenu(task, taskIndex);
    items.push(completionSubmenu);

    items.forEach(item => menu.appendChild(item));

    document.body.appendChild(menu);

    // Position menu at cursor
    let left = event.clientX;
    let top = event.clientY;

    // Ensure menu doesn't overflow the viewport
    const menuRect = menu.getBoundingClientRect();
    if (left + menuRect.width > window.innerWidth) {
        left = window.innerWidth - menuRect.width - 8;
    }
    if (top + menuRect.height > window.innerHeight) {
        top = window.innerHeight - menuRect.height - 8;
    }
    if (top < 0) top = 8;
    if (left < 0) left = 8;

    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    // Focus the first menu item for keyboard navigation
    const firstItem = menu.querySelector('button[role="menuitem"]');
    if (firstItem) firstItem.focus();

    // Keyboard navigation within the menu
    menu.addEventListener('keydown', handleContextMenuKeydown);

    // Close when clicking outside
    setTimeout(() => {
        document.addEventListener('click', closeTaskContextMenuOnOutsideClick);
    }, 0);
}

/**
 * Handle keyboard navigation within the task context menu.
 */
function handleContextMenuKeydown(e) {
    const menu = document.getElementById('activeTaskContextMenu');
    if (!menu) return;

    const menuItems = Array.from(menu.querySelectorAll('button[role="menuitem"]'));
    const currentIndex = menuItems.indexOf(document.activeElement);

    switch (e.key) {
        case 'Escape':
            e.preventDefault();
            closeTaskContextMenu();
            break;
        case 'ArrowDown':
            e.preventDefault();
            if (currentIndex < menuItems.length - 1) {
                menuItems[currentIndex + 1].focus();
            } else {
                menuItems[0].focus();
            }
            break;
        case 'ArrowUp':
            e.preventDefault();
            if (currentIndex > 0) {
                menuItems[currentIndex - 1].focus();
            } else {
                menuItems[menuItems.length - 1].focus();
            }
            break;
        case 'Home':
            e.preventDefault();
            menuItems[0].focus();
            break;
        case 'End':
            e.preventDefault();
            menuItems[menuItems.length - 1].focus();
            break;
        case 'Tab':
            e.preventDefault();
            closeTaskContextMenu();
            break;
    }
}

function closeTaskContextMenuOnOutsideClick(e) {
    const menu = document.getElementById('activeTaskContextMenu');
    if (menu && !menu.contains(e.target)) {
        closeTaskContextMenu();
    }
}

function closeTaskContextMenu() {
    const menu = document.getElementById('activeTaskContextMenu');
    if (menu) {
        // Reset aria-expanded on the trigger button
        if (menu._triggerBtn) {
            menu._triggerBtn.setAttribute('aria-expanded', 'false');
            menu._triggerBtn.focus();
        }
        menu.removeEventListener('keydown', handleContextMenuKeydown);
        menu.remove();
    }
    document.removeEventListener('click', closeTaskContextMenuOnOutsideClick);
}

function createContextMenuItem(label, icon, onClick) {
    const item = document.createElement('button');
    item.className = 'task-context-menu-item';
    item.setAttribute('role', 'menuitem');

    const iconSpan = document.createElement('span');
    iconSpan.className = 'menu-icon';
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.textContent = icon;
    item.appendChild(iconSpan);

    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    item.appendChild(labelSpan);

    item.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTaskContextMenu();
        onClick();
    });

    return item;
}

function createContextMenuSeparator() {
    const sep = document.createElement('div');
    sep.className = 'task-context-menu-separator';
    sep.setAttribute('role', 'separator');
    return sep;
}

function createCompletionSubmenu(task, taskIndex) {
    const wrapper = document.createElement('div');
    wrapper.className = 'task-context-submenu';

    const trigger = document.createElement('button');
    trigger.className = 'task-context-menu-item';
    trigger.setAttribute('role', 'menuitem');
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-expanded', 'false');

    const iconSpan = document.createElement('span');
    iconSpan.className = 'menu-icon';
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.textContent = '\u2714';
    trigger.appendChild(iconSpan);

    const labelSpan = document.createElement('span');
    labelSpan.textContent = 'Set Completion';
    trigger.appendChild(labelSpan);

    const arrow = document.createElement('span');
    arrow.className = 'menu-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '\u25B6';
    trigger.appendChild(arrow);

    wrapper.appendChild(trigger);

    const submenu = document.createElement('div');
    submenu.className = 'task-context-submenu-items';
    submenu.setAttribute('role', 'menu');
    submenu.setAttribute('aria-label', 'Completion options');

    const currentPercent = parseInt(String(task.percent || '0').replace('%', '')) || 0;

    [0, 25, 50, 75, 100].forEach(pct => {
        const item = document.createElement('button');
        item.className = 'task-context-menu-item completion-item';
        item.setAttribute('role', 'menuitem');
        if (currentPercent === pct) {
            item.classList.add('completion-active');
            item.setAttribute('aria-current', 'true');
        }
        item.textContent = pct + '%';
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            closeTaskContextMenu();
            setTaskCompletion(task, taskIndex, pct);
        });
        submenu.appendChild(item);
    });

    // Show submenu on hover and update aria-expanded
    wrapper.addEventListener('mouseenter', () => {
        trigger.setAttribute('aria-expanded', 'true');
    });
    wrapper.addEventListener('mouseleave', () => {
        trigger.setAttribute('aria-expanded', 'false');
    });

    wrapper.appendChild(submenu);
    return wrapper;
}

/**
 * Promote (outdent) a task: remove 2 leading spaces from its line in the editor.
 */
function promoteTask(task, taskIndex) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const lineNumber = findTaskLineNumber(task);
    if (lineNumber < 1) return;

    const lines = editor.value.split('\n');
    const lineIdx = lineNumber - 1;
    const line = lines[lineIdx];

    // Remove up to 2 leading spaces
    if (line.startsWith('  ')) {
        lines[lineIdx] = line.substring(2);
    } else if (line.startsWith(' ')) {
        lines[lineIdx] = line.substring(1);
    } else {
        return; // Already at root level
    }

    editor.value = lines.join('\n');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Demote (indent) a task: add 2 leading spaces to its line in the editor.
 */
function demoteTask(task, taskIndex) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const lineNumber = findTaskLineNumber(task);
    if (lineNumber < 1) return;

    const lines = editor.value.split('\n');
    const lineIdx = lineNumber - 1;
    lines[lineIdx] = '  ' + lines[lineIdx];

    editor.value = lines.join('\n');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Insert a blank task line above the given task and open the editor form.
 */
function insertTaskAbove(task, taskIndex) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const lineNumber = findTaskLineNumber(task);
    if (lineNumber < 1) return;

    const lines = editor.value.split('\n');
    const lineIdx = lineNumber - 1;

    // Match the indentation of the current task
    const currentLine = lines[lineIdx];
    const indentMatch = currentLine.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '';

    // Insert a new task line with the same indent
    const newTaskName = 'New Task';
    lines.splice(lineIdx, 0, indent + newTaskName);

    editor.value = lines.join('\n');
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    // Open the task form for the new line and focus the title
    setTimeout(() => {
        openTaskForm(lineNumber);
        // Focus and select the title text so the user can immediately
        // type a replacement name (fixes #648).
        setTimeout(() => {
            const titleEl = document.getElementById('taskFormPanelHeader')?.shadowRoot?.querySelector('[contenteditable]');
            if (titleEl) {
                titleEl.focus();
                const sel = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(titleEl);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        }, 50);
    }, 100);
}

/**
 * Show a prompt to assign a resource to a task.
 */
function assignResourceToTask(task, taskIndex) {
    const currentResource = task.resources || '';
    const resource = prompt('Assign resource:', currentResource);
    if (resource === null) return; // Cancelled

    task.resources = resource;
    ganttTasks[taskIndex].resources = resource;
    syncGanttEditToEditor(task, taskIndex, 'resources', resource);
    renderGanttRows();
    if (ganttTasks === window._lastTasksTableTasks) {
        updateTasksTable(ganttTasks);
    }
}

/**
 * Set the completion percentage for a task.
 */
function setTaskCompletion(task, taskIndex, percent) {
    const newPercent = percent + '%';
    task.percent = newPercent;
    ganttTasks[taskIndex].percent = newPercent;
    syncGanttPercentToEditor(task, taskIndex);
}

/**
 * Create a three-dot context menu button for a task row.
 */
function createTaskContextButton(task, taskIndex) {
    const btn = document.createElement('button');
    btn.className = 'task-context-btn';
    btn.title = 'More actions';
    btn.setAttribute('aria-label', 'More actions for ' + (task.name || 'task'));
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = '\u22EF';
    btn.addEventListener('click', (e) => {
        showTaskContextMenu(e, task, taskIndex);
    });
    return btn;
}

// Indentation width for a line, with tabs expanded to a fixed column count so
// tab- and space-indented plans (and anything in between) compare on the same
// scale. Only the ordering between lines matters to populateSubtasks() below,
// not the absolute value.
function getIndentWidth(line, tabWidth = 4) {
    let width = 0;
    for (const ch of line) {
        if (ch === ' ') width += 1;
        else if (ch === '\t') width += tabWidth;
        else break;
    }
    return width;
}

// Direct-child line numbers (1-indexed) of the task at parentLineNumber.
// Pure and DOM-free so it can be unit tested directly (see
// tests/test_subtask_indentation.js).
//
// Levels are derived the same way scheduling_engine.py's indent parser does
// server-side (#748 was the same class of bug there): walk a stack of
// enclosing indents, and whatever is deeper than the nearest one on the
// stack becomes its child, one level down -- whatever the actual column
// delta is. This replaces the old `indentDiff === 2 || indentDiff === 4`
// check, which silently dropped every child on a tab-indented, 3-space,
// 8-space or mixed-indent (post-import) plan.
function findDirectChildLineNumbers(parentLineNumber, lines) {
    const parentLine = lines[parentLineNumber - 1];
    const parentIndent = getIndentWidth(parentLine);
    const childLineNumbers = [];
    const indentStack = [{ indent: parentIndent, level: 0 }];
    for (let i = parentLineNumber; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Skip empty lines
        if (!trimmed) continue;

        // Back-matter marker (RAID log, comms, baseline, etc.) -- the task
        // outline is over, so stop scanning rather than skipping past it
        // and risking back matter being read as more of the outline.
        if (trimmed.startsWith('---') || trimmed.startsWith('#') || trimmed.includes('===')) break;

        const indent = getIndentWidth(line);

        // Same or lower indentation than the parent: its subtree is done.
        if (indent <= parentIndent) break;

        while (indentStack.length > 1 && indentStack[indentStack.length - 1].indent >= indent) {
            indentStack.pop();
        }
        const level = indentStack[indentStack.length - 1].level + 1;
        indentStack.push({ indent, level });

        // Only the level immediately below the parent is a direct child;
        // anything deeper is a grandchild (or further) and is excluded.
        if (level === 1) {
            childLineNumbers.push(i + 1);
        }
    }
    return childLineNumbers;
}

/**
 * Walk the outline beneath `parentLineNumber` and return EVERY descendant
 * task -- direct children, grandchildren, and so on -- not just the
 * immediate next level. A line belongs to the subtree as long as it stays
 * more indented than the parent; that ends the moment a line comes back
 * down to the parent's indent (or shallower), the same "contiguous run of
 * more-indented lines" convention deleteTask() and moveTaskInEditor() use
 * elsewhere in this file to find a task's full subtree.
 *
 * Each returned task also carries `depth` (1 = direct child, 2 = grandchild,
 * ...), tracked with an indent stack the same way parseTaskOutline() does in
 * msproject-task-diff.js -- this tolerates plans that mix tabs, 2-space,
 * 4-space, and irregular post-import indent steps.
 */
function getTaskDescendants(parentLineNumber, lines) {
    const parentLine = lines[parentLineNumber - 1];
    if (parentLine === undefined) return [];
    const parentIndent = getIndentWidth(parentLine);

    const descendants = [];
    const indentStack = [{ indent: parentIndent, level: 0 }];
    for (let i = parentLineNumber; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!trimmed) continue;
        if (trimmed.startsWith('---') || trimmed.startsWith('#') || trimmed.includes('===')) break;

        const indent = getIndentWidth(line);
        if (indent <= parentIndent) break;

        while (indentStack.length > 1 && indentStack[indentStack.length - 1].indent >= indent) {
            indentStack.pop();
        }
        const depth = indentStack[indentStack.length - 1].level + 1;
        indentStack.push({ indent, level: depth });

        const task = parseTaskLine(line, i + 1);
        if (task.name) {
            descendants.push({
                ...task,
                lineNumber: i + 1,
                depth
            });
        }
    }
    return descendants;
}

function populateSubtasks(parentLineNumber, lines) {
    const subtasksList = document.getElementById('subtasksList');
    if (!subtasksList) return;

    subtasksList.innerHTML = '';

    // Every descendant of this task, at any depth (issue #979: the list
    // previously only included direct children, so grandchildren and
    // deeper descendants silently went missing here).
    const subtasks = getTaskDescendants(parentLineNumber, lines);

    // Display subtasks
    if (subtasks.length === 0) {
        subtasksList.innerHTML = '<div style="padding: 10px; color: var(--np-faint); text-align: center;">No sub tasks</div>';
        // Enable percent input for non-summary tasks
        const percentInput = document.getElementById('taskPercent');
        const helperText = document.getElementById('percentHelperText');
        if (percentInput) {
            percentInput.readOnly = false;
            percentInput.dataset.isSummary = 'false';
            percentInput.style.backgroundColor = '';
            percentInput.style.cursor = '';
        }
        if (helperText) {
            helperText.style.display = 'none';
        }
        syncPercentQuickControlsState();
        return subtasks;
    }

    // Get resource mappings for displaying full names and initials
    const editor = document.getElementById('planEditor');
    const resourceMap = editor ? parseResourceMappings(editor.value) : {};

    subtasks.forEach(subtask => {
        const item = document.createElement('div');
        item.className = 'subtask-item';
        // Indent grandchildren and deeper descendants so the flat list still
        // reads as a hierarchy; direct children (depth 1) sit flush left,
        // matching the pre-existing layout for plans with no nesting.
        if (subtask.depth > 1) {
            item.style.marginLeft = ((subtask.depth - 1) * 18) + 'px';
        }

        const subtaskPercent = parseInt(subtask.percent) || 0;
        const piechart = createMiniPiechart(subtaskPercent, (newPercent) => {
            toggleSubtaskCompletion(subtask.lineNumber, newPercent);
        });

        const label = document.createElement('span');
        label.className = 'subtask-label';
        label.textContent = subtask.name;
        label.addEventListener('click', () => {
            // Navigate directly to the subtask's details
            openTaskForm(subtask.lineNumber);
        });

        // Right-side container for dates and resources
        const rightSection = document.createElement('div');
        rightSection.className = 'subtask-right-section';

        // Date display - use backend calculated dates if subtask has no explicit dates
        let displayStartDate = subtask.startDate;
        let displayFinishDate = subtask.finishDate;
        if (!displayStartDate || !displayFinishDate) {
            const backendSubtask = lastRenderedTasks.find(bt => bt.name === subtask.name);
            if (backendSubtask) {
                if (!displayStartDate && backendSubtask.start) displayStartDate = backendSubtask.start;
                if (!displayFinishDate && backendSubtask.finish) displayFinishDate = backendSubtask.finish;
            }
        }
        if (displayStartDate || displayFinishDate) {
            const dateSpan = document.createElement('span');
            dateSpan.className = 'subtask-dates';
            const startStr = displayStartDate ? formatSubtaskDate(displayStartDate) : '';
            const finishStr = displayFinishDate ? formatSubtaskDate(displayFinishDate) : '';
            if (startStr && finishStr) {
                dateSpan.textContent = `${startStr} – ${finishStr}`;
            } else if (startStr) {
                dateSpan.textContent = startStr;
            } else {
                dateSpan.textContent = finishStr;
            }
            rightSection.appendChild(dateSpan);
        }

        // Resource avatars
        const resourceContainer = document.createElement('div');
        resourceContainer.className = 'subtask-resources';
        const resourceList = subtask.resources
            ? subtask.resources.split(',').map(r => r.trim()).filter(r => r)
            : [];

        if (resourceList.length > 0) {
            resourceList.forEach(shortname => {
                const fullName = resourceMap[shortname.toLowerCase()] || shortname;
                const avatar = document.createElement('div');
                avatar.className = 'subtask-resource-avatar';
                avatar.title = fullName;
                avatar.textContent = getResourceInitials(fullName);
                resourceContainer.appendChild(avatar);
            });
        } else {
            // Empty circle for unassigned
            const emptyAvatar = document.createElement('div');
            emptyAvatar.className = 'subtask-resource-avatar subtask-resource-unassigned';
            emptyAvatar.title = 'Assign a resource';
            resourceContainer.appendChild(emptyAvatar);
        }

        // Click handler for resource assignment
        resourceContainer.addEventListener('click', (e) => {
            e.stopPropagation();
            // Don't reopen if picker is already showing
            if (document.querySelector('.subtask-resource-picker')) return;
            showSubtaskResourcePicker(resourceContainer, subtask, resourceMap);
        });

        rightSection.appendChild(resourceContainer);
        item.appendChild(piechart);
        item.appendChild(label);
        item.appendChild(rightSection);
        subtasksList.appendChild(item);
    });

    // Only auto-calculate percent for actual summary tasks (confirmed by backend)
    const taskName = document.getElementById('taskName').value;
    const backendConfirmed = lastRenderedTasks && lastRenderedTasks.find(
        t => t.name === taskName && t.is_summary
    );

    // Calculate average completion for summary tasks -- based on DIRECT
    // children only (depth 1). `subtasks` now includes every descendant, but
    // each direct child's own percent already reflects its own descendants
    // (a nested summary's percent is itself auto-calculated the same way
    // when its form is open), so averaging over every depth would double
    // count deeper levels instead of rolling up one level at a time.
    const directChildren = subtasks.filter(task => task.depth === 1);
    const totalPercent = directChildren.reduce((sum, task) => sum + (parseInt(task.percent) || 0), 0);
    const avgPercent = directChildren.length ? Math.round(totalPercent / directChildren.length) : 0;

    // Update percent field — only override if backend confirms this is a summary
    const percentInput = document.getElementById('taskPercent');
    const helperText = document.getElementById('percentHelperText');
    if (percentInput && backendConfirmed) {
        percentInput.value = avgPercent;
        percentInput.readOnly = true;
        percentInput.dataset.isSummary = 'true';
        percentInput.style.backgroundColor = '#f0f0f0';
        percentInput.style.cursor = 'not-allowed';

        // Update progress bar and RAG status to reflect calculated percent
        updateProgressBar();
        updateRagDisplay();
    }

    // Show helper text
    if (helperText) {
        helperText.style.display = 'block';
    }

    return subtasks;
}

function getResourceInitials(name) {
    const words = name.trim().split(/\s+/);
    if (words.length >= 2) {
        return (words[0][0] + words[words.length - 1][0]).toUpperCase();
    } else if (words.length === 1 && words[0].length >= 2) {
        return words[0].substring(0, 2).toUpperCase();
    }
    return name.substring(0, 1).toUpperCase();
}

function formatSubtaskDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const year = parts[0].slice(-2);
        const monthIdx = parseInt(parts[1], 10) - 1;
        return `${parseInt(parts[2], 10)} ${months[monthIdx]} ${year}`;
    }
    return dateStr;
}

function showSubtaskResourcePicker(container, subtask, resourceMap) {
    // Close any existing picker
    const existingPicker = document.querySelector('.subtask-resource-picker');
    if (existingPicker) {
        existingPicker.remove();
    }

    const picker = document.createElement('div');
    picker.className = 'subtask-resource-picker';

    const currentResources = subtask.resources
        ? subtask.resources.split(',').map(r => r.trim().toLowerCase()).filter(r => r)
        : [];

    const allResources = Object.keys(resourceMap).sort();

    // Header
    const header = document.createElement('div');
    header.className = 'subtask-resource-picker-header';
    header.textContent = 'Assign Resources';
    picker.appendChild(header);

    // List of currently assigned resources with remove button
    if (currentResources.length > 0) {
        const assignedSection = document.createElement('div');
        assignedSection.className = 'subtask-resource-picker-assigned';
        currentResources.forEach(shortname => {
            const fullName = resourceMap[shortname] || shortname;
            const row = document.createElement('div');
            row.className = 'subtask-resource-picker-row assigned';
            const nameSpan = document.createElement('span');
            nameSpan.textContent = fullName;
            const removeBtn = document.createElement('span');
            removeBtn.className = 'subtask-resource-remove';
            removeBtn.textContent = '\u00D7';
            removeBtn.title = 'Remove';
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                updateSubtaskResource(subtask, shortname, 'remove');
                picker.remove();
            });
            row.appendChild(nameSpan);
            row.appendChild(removeBtn);
            assignedSection.appendChild(row);
        });
        picker.appendChild(assignedSection);
    }

    // List of available resources to add
    const availableResources = allResources.filter(r => !currentResources.includes(r));
    if (availableResources.length > 0) {
        const availSection = document.createElement('div');
        availSection.className = 'subtask-resource-picker-available';
        const availHeader = document.createElement('div');
        availHeader.className = 'subtask-resource-picker-subheader';
        availHeader.textContent = 'Add resource';
        availSection.appendChild(availHeader);
        availableResources.forEach(shortname => {
            const fullName = resourceMap[shortname] || shortname;
            const row = document.createElement('div');
            row.className = 'subtask-resource-picker-row available';
            row.textContent = fullName;
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                updateSubtaskResource(subtask, shortname, 'add');
                picker.remove();
            });
            availSection.appendChild(row);
        });
        picker.appendChild(availSection);
    }

    // If no resources defined in front matter
    if (allResources.length === 0) {
        const noResources = document.createElement('div');
        noResources.className = 'subtask-resource-picker-empty';
        noResources.textContent = 'No resources defined in plan front matter';
        picker.appendChild(noResources);
    }

    // Use fixed positioning to avoid overflow clipping from .subtasks-list
    const rect = container.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.right = (window.innerWidth - rect.right) + 'px';
    picker.style.top = (rect.bottom + 4) + 'px';
    picker.style.zIndex = '10000';
    document.body.appendChild(picker);

    // Close picker when clicking outside
    const closeHandler = (e) => {
        if (!picker.contains(e.target)) {
            picker.remove();
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

function updateSubtaskResource(subtask, shortname, action) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const lines = editor.value.split('\n');
    const lineIndex = subtask.lineNumber - 1;
    if (lineIndex < 0 || lineIndex >= lines.length) return;

    let line = lines[lineIndex];

    const currentResources = subtask.resources
        ? subtask.resources.split(',').map(r => r.trim().toLowerCase()).filter(r => r)
        : [];

    if (action === 'add') {
        // Add @shortname to the line
        line = line.trimEnd() + ' @' + shortname;
    } else if (action === 'remove') {
        // Remove @shortname from the line (case-insensitive)
        line = line.replace(new RegExp('\\s*@' + shortname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');
    }

    lines[lineIndex] = line;
    editor.value = lines.join('\n');
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    // Re-populate subtasks to reflect changes
    populateSubtasks(currentTaskLineNumber, lines);
}

function toggleSubtaskCompletion(lineNumber, percentOrBool) {
    const editor = document.getElementById('planEditor');
    const lines = editor.value.split('\n');
    const line = lines[lineNumber - 1];

    // Parse the task
    const task = parseTaskLine(line, lineNumber);

    // Support both boolean (legacy) and string percent like '50%'
    let targetPercent;
    if (typeof percentOrBool === 'boolean') {
        targetPercent = percentOrBool ? '100%' : '0%';
    } else {
        targetPercent = percentOrBool;
    }

    // Extract indent from the line
    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '';

    // Use updatePercentInLine for consistent percent placement
    const updatedLine = updatePercentInLine(line, targetPercent, indent, task.name);

    // Update the line
    lines[lineNumber - 1] = updatedLine;
    editor.value = lines.join('\n');

    // Trigger input event to update line numbers and syntax highlighting
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    // Re-populate subtasks to reflect changes
    populateSubtasks(currentTaskLineNumber, lines);
}

function addNewSubtask() {
    const subtasksList = document.getElementById('subtasksList');
    if (!subtasksList) return;

    // Create new editable subtask item
    const item = document.createElement('div');
    item.className = 'subtask-item subtask-item-editing';

    const piechartPlaceholder = document.createElement('div');
    piechartPlaceholder.className = 'mini-piechart';
    piechartPlaceholder.style.setProperty('--percent', '0%');
    piechartPlaceholder.style.background = 'conic-gradient(#28a745 0% 0%, #e0e0e0 0% 100%)';
    piechartPlaceholder.style.pointerEvents = 'none';
    piechartPlaceholder.style.opacity = '0.5';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'subtask-input';
    input.placeholder = 'Enter subtask name...';
    input.style.flex = '1';
    input.style.border = '1px solid #108bb9';
    input.style.borderRadius = '3px';
    input.style.padding = '4px 8px';
    input.style.outline = 'none';

    // Handle save on Enter or blur
    let saved = false;
    const saveSubtask = () => {
        if (saved) return;

        const taskName = input.value.trim();
        if (!taskName) {
            item.remove();
            return;
        }

        saved = true;

        const editor = document.getElementById('planEditor');
        const lines = editor.value.split('\n');

        // Get parent task line
        const parentLine = lines[currentTaskLineNumber - 1];
        const parentIndent = parentLine.search(/\S/);

        // Create new subtask with one more level of indentation
        const childIndent = ' '.repeat(parentIndent + 2);
        const newTaskLine = `${childIndent}${taskName}`;

        // Find where to insert - after all existing child tasks
        let insertIndex = currentTaskLineNumber;

        // Look for existing child tasks and find the last one
        for (let i = currentTaskLineNumber; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Skip empty lines
            if (!trimmed) continue;

            // Skip front matter, phase headers, summary lines
            if (trimmed.startsWith('---') || trimmed.startsWith('#') || trimmed.includes('===')) break;

            const indent = line.search(/\S/);

            // If we hit a line at same or lower indentation than parent, we're done
            if (indent <= parentIndent) {
                break;
            }

            // This is a child task, update insert position to after it
            insertIndex = i + 1;
        }

        // Insert the new line
        lines.splice(insertIndex, 0, newTaskLine);
        editor.value = lines.join('\n');

        // Trigger input event to update line numbers and syntax highlighting
        editor.dispatchEvent(new Event('input', { bubbles: true }));

        // Re-populate subtasks to show the new task properly
        populateSubtasks(currentTaskLineNumber, editor.value.split('\n'));
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveSubtask();
        } else if (e.key === 'Escape') {
            item.remove();
        }
    });

    input.addEventListener('blur', () => {
        saveSubtask();
    });

    item.appendChild(piechartPlaceholder);
    item.appendChild(input);

    // Remove "No sub tasks" message if present
    const noTasksMsg = subtasksList.querySelector('div[style*="text-align: center"]');
    if (noTasksMsg) {
        noTasksMsg.remove();
    }

    subtasksList.appendChild(item);
    input.focus();
}

// Called when date fields change - recalculate duration
function onDateChange(field) {
    const startDateField = document.getElementById('taskStartDate');
    const finishDateField = document.getElementById('taskFinishDate');
    const durationField = document.getElementById('taskDuration');
    const startDate = startDateField.value;
    const finishDate = finishDateField.value;

    // Mark which field was changed by user
    if (field === 'start') {
        userSetStartDate = !!startDate;
        startDateField.style.fontStyle = 'normal';
    } else if (field === 'finish') {
        userSetFinishDate = !!finishDate;
        finishDateField.style.fontStyle = 'normal';
    }

    // If both dates exist, calculate duration from them
    if (startDate && finishDate) {
        const start = new Date(startDate);
        const finish = new Date(finishDate);
        const diffTime = Math.abs(finish - start);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        durationField.value = diffDays;

        // Keep duration as auto-calculated (italic) unless user explicitly set it
        if (!userSetDuration) {
            durationField.style.fontStyle = 'italic';
        }
    }

    saveTask();
    updateRagDisplay();
}

// Called when the deadline field changes. A deadline never drives
// scheduling -- it does not touch start/finish/duration, only the RAG
// slippage flag, so this just persists the field and refreshes that.
function onDeadlineChange() {
    saveTask();
    updateRagDisplay();
}

// Called when duration field changes - recalculate finish date
function onDurationChange() {
    const startDateField = document.getElementById('taskStartDate');
    const finishDateField = document.getElementById('taskFinishDate');
    const durationField = document.getElementById('taskDuration');
    const startDate = startDateField.value;
    const duration = durationField.value;

    // Mark duration as user-set
    userSetDuration = !!duration;
    durationField.style.fontStyle = 'normal';

    // If start date and duration exist, calculate finish date (skipping weekends)
    if (startDate && duration) {
        const durationDays = parseInt(duration);
        if (!isNaN(durationDays)) {
            const start = new Date(startDate);
            const finish = addWorkingDays(start, durationDays);
            finishDateField.value = finish.toISOString().split('T')[0];

            // Keep finish date as auto-calculated (italic) unless user explicitly set it
            if (!userSetFinishDate) {
                finishDateField.style.fontStyle = 'italic';
            }
        }
    }

    saveTask();
    updateRagDisplay();
}

function updateTaskNameFromTitle() {
    // Don't update if the task form is not active
    const taskSection = document.getElementById('taskFormSection');
    if (taskSection && !taskSection.classList.contains('active')) return;

    const titleEl = document.getElementById('taskFormPanelHeader')?.shadowRoot?.querySelector('[contenteditable]');
    const title = (titleEl ? titleEl.innerText : '').trim();
    document.getElementById('taskName').value = title;
    saveTask();
}

document.getElementById('taskFormPanelHeader')?.addEventListener('titlechange', updateTaskNameFromTitle);

function updateRagDisplay() {
    const percent = parseInt(document.getElementById('taskPercent').value) || 0;
    const startDateStr = document.getElementById('taskStartDate').value;
    const finishDateStr = document.getElementById('taskFinishDate').value;
    const deadlineField = document.getElementById('taskDeadline');
    const deadlineStr = deadlineField ? deadlineField.value : '';
    const ragDisplay = document.getElementById('ragDisplay');
    const ragReasoning = document.getElementById('ragReasoning');

    let ragStatus, bgColor, textColor, reasoning;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // RAG logic based on backend rules (from calculate_rag_status):

    // Blue: Task is 100% complete
    if (percent === 100) {
        ragStatus = 'Complete';
        bgColor = '#1976d2';
        textColor = 'white';
        reasoning = 'Task is complete';
    }
    // Red: deadline slippage (#877). A deadline is a fixed marker, distinct
    // from the on-track/behind-schedule comparison below and from the
    // start/finish dates, which it never moves. Checked next so this
    // preview agrees with calculate_rag_status.
    else if (deadlineStr && (
        new Date(deadlineStr) < today ||
        (finishDateStr && new Date(finishDateStr) > new Date(deadlineStr))
    )) {
        ragStatus = 'Task Overdue';
        bgColor = '#f44336';
        textColor = 'white';
        reasoning = new Date(deadlineStr) < today
            ? 'Deadline has passed and the task is not complete'
            : 'Not on track to complete by the deadline';
    }
    // Green: Task hasn't started yet (start date is in the future)
    else if (startDateStr && new Date(startDateStr) > today) {
        if (percent > 0) {
            ragStatus = 'Ahead of Schedule';
            bgColor = '#4caf50';
            textColor = 'white';
            reasoning = 'Ahead of schedule: ' + percent + '% complete before start date';
        } else {
            ragStatus = 'Not Started';
            bgColor = '#4caf50';
            textColor = 'white';
            reasoning = 'Task not due to start yet';
        }
    }
    // Red: Start date is in the past and no progress or 0%
    else if (startDateStr && new Date(startDateStr) <= today && percent === 0) {
        ragStatus = 'Task Overdue';
        bgColor = '#f44336';
        textColor = 'white';
        reasoning = 'Task overdue - no progress reported';
    }
    // Calculate expected progress based on dates
    else if (startDateStr && finishDateStr) {
        const startDate = new Date(startDateStr);
        const finishDate = new Date(finishDateStr);
        const totalDuration = (finishDate - startDate) / (1000 * 60 * 60 * 24);
        const elapsedDays = Math.max(0, (today - startDate) / (1000 * 60 * 60 * 24));
        const expectedPercent = Math.min(100, (elapsedDays / Math.max(1, totalDuration)) * 100);

        // Amber: Actual progress is less than expected
        if (percent < expectedPercent) {
            ragStatus = 'Behind Schedule';
            bgColor = '#ff9800';
            textColor = 'white';
            reasoning = 'Behind schedule: ' + percent + '% complete, expected ' + Math.round(expectedPercent) + '%';
        } else {
            // Green: On track or ahead
            ragStatus = 'On Track';
            bgColor = '#4caf50';
            textColor = 'white';
            reasoning = 'On track or ahead of schedule';
        }
    }
    // Fallback: Use simple percentage thresholds if no dates
    else if (percent === 0) {
        ragStatus = 'Task Overdue';
        bgColor = '#f44336';
        textColor = 'white';
        reasoning = 'No progress made';
    } else if (percent < 50) {
        ragStatus = 'Task Overdue';
        bgColor = '#f44336';
        textColor = 'white';
        reasoning = 'Progress below 50%';
    } else if (percent < 80) {
        ragStatus = 'Behind Schedule';
        bgColor = '#ff9800';
        textColor = 'white';
        reasoning = 'Progress 50-79%';
    } else {
        ragStatus = 'On Track';
        bgColor = '#4caf50';
        textColor = 'white';
        reasoning = 'Progress >=80%';
    }

    if (ragDisplay) {
        ragDisplay.textContent = ragStatus;
        ragDisplay.style.backgroundColor = bgColor;
        ragDisplay.style.color = textColor;
    }
    if (ragReasoning) {
        ragReasoning.textContent = reasoning;
    }
}

function updateProgressBar() {
    const percent = parseInt(document.getElementById('taskPercent').value) || 0;
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');

    if (!progressBar) return;

    progressBar.style.width = percent + '%';
    progressBar.setAttribute('aria-valuenow', percent);
    if (progressText) {
        progressText.textContent = percent > 0 ? percent + '%' : '';
    }

    // Update color based on percentage
    progressBar.className = 'progress-bar progress-bar-striped';
    if (percent === 100) {
        progressBar.classList.add('bg-success');
    } else if (percent >= 80) {
        progressBar.classList.add('bg-success');
    } else if (percent >= 50) {
        progressBar.classList.add('bg-warning');
    } else if (percent > 0) {
        progressBar.classList.add('bg-danger');
    } else {
        progressBar.classList.add('bg-secondary');
    }

    syncPercentQuickControlsState();
}

/**
 * Enable/disable the click-to-complete progress bar and the 0/25/50/75/100
 * quick-set toolbar to match whether #taskPercent is currently editable.
 * Percent is auto-calculated (and the input made readOnly) for summary
 * tasks and for effort-driven tasks -- the quick controls must not be able
 * to fight that calculated value. Called from updateProgressBar() (which
 * already runs after every place that toggles readOnly) plus the couple of
 * spots below that flip readOnly without also calling updateProgressBar().
 */
function syncPercentQuickControlsState() {
    const percentInput = document.getElementById('taskPercent');
    const isLocked = !!(percentInput && percentInput.readOnly);

    const progressWrapper = document.getElementById('taskProgressBarWrapper');
    if (progressWrapper) {
        progressWrapper.classList.toggle('percent-control-disabled', isLocked);
        progressWrapper.title = isLocked
            ? 'Auto-calculated — not editable here'
            : 'Click to mark 100% complete';
    }

    const quickToolbar = document.getElementById('percentQuickToolbar');
    if (quickToolbar) {
        quickToolbar.querySelectorAll('button').forEach(btn => {
            btn.disabled = isLocked;
        });
    }
}

/**
 * Quick-set the current task's completion percentage from the task details
 * form. Backs both the click-to-complete progress bar (clicking jumps
 * straight to 100%) and the 0/25/50/75/100 mini-toolbar buttons. Goes
 * through the same saveTask()/updateRagDisplay()/updateProgressBar()
 * sequence #taskPercent's own oninput handler uses, so the markdown
 * write-back and RAG/progress-bar refresh are identical to typing a value
 * by hand.
 */
function setTaskPercentQuick(percent) {
    const percentInput = document.getElementById('taskPercent');
    if (!percentInput || percentInput.readOnly) return;

    percentInput.value = percent;
    saveTask();
    updateRagDisplay();
    updateProgressBar();
}

function updateEffortTotal() {
    const completedInput = document.getElementById('taskEffortCompleted');
    const remainingInput = document.getElementById('taskEffortRemaining');
    const totalInput = document.getElementById('taskEffortTotal');
    const totalUnitSpan = document.getElementById('taskEffortTotalUnit');
    const completedUnit = document.getElementById('taskEffortCompletedUnit');
    const remainingUnit = document.getElementById('taskEffortRemainingUnit');

    if (!completedInput || !remainingInput || !totalInput) return;

    const completed = parseFloat(completedInput.value) || 0;
    const remaining = parseFloat(remainingInput.value) || 0;

    // Convert to common unit (hours) for calculation if units differ
    const cUnit = completedUnit ? completedUnit.value : 'h';
    const rUnit = remainingUnit ? remainingUnit.value : 'h';

    const completedHours = cUnit === 'd' ? completed * 8 : completed;
    const remainingHours = rUnit === 'd' ? remaining * 8 : remaining;
    const totalHours = completedHours + remainingHours;

    // Display total in the most appropriate unit
    if (cUnit === rUnit) {
        // Same units - just add
        totalInput.value = completed + remaining;
        if (totalUnitSpan) totalUnitSpan.textContent = cUnit;
    } else {
        // Different units - show in hours
        totalInput.value = totalHours;
        if (totalUnitSpan) totalUnitSpan.textContent = 'h';
    }

    // Auto-calculate percent from effort if total > 0
    if (totalHours > 0) {
        const effortPercent = Math.max(0, Math.min(100, Math.round(completedHours / totalHours * 100)));
        const percentInput = document.getElementById('taskPercent');
        if (percentInput) {
            percentInput.value = effortPercent;
            percentInput.readOnly = true;
            percentInput.title = 'Auto-calculated from effort (completed / total)';
            percentInput.style.fontStyle = 'italic';
        }
    } else {
        // No effort data - restore manual percent editing
        const percentInput = document.getElementById('taskPercent');
        if (percentInput && percentInput.dataset.isSummary !== 'true') {
            percentInput.readOnly = false;
            percentInput.title = '';
            percentInput.style.fontStyle = 'normal';
        }
    }
    syncPercentQuickControlsState();

    saveTask();
}

function closeTaskForm() {
    closeDetailPane();
    currentTaskLineNumber = null;
}

document.getElementById('taskFormPanelHeader')?.addEventListener('close', closeTaskForm);

/**
 * Delete the currently open task from the plan.
 * Shows a confirmation dialog, removes the task line (and any subtask lines
 * that are more deeply indented beneath it), then refreshes the editor and views.
 */
function deleteTask() {
    if (currentTaskLineNumber === null) return;

    const editor = document.getElementById('planEditor');
    const lines = editor.value.split('\n');
    const lineIndex = currentTaskLineNumber - 1;

    if (lineIndex < 0 || lineIndex >= lines.length) {
        console.error('deleteTask: invalid line number', currentTaskLineNumber);
        return;
    }

    const taskLine = lines[lineIndex];
    const taskName = extractTaskNameFromEditorLine(taskLine) || 'this task';

    // Determine the range of lines to delete (task + subtasks).
    // Subtasks are consecutive lines with strictly greater indentation.
    const parentIndent = taskLine.search(/\S/);
    let endIndex = lineIndex + 1; // exclusive
    for (let i = lineIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        // Keep blank lines that sit between subtasks
        if (line.trim() === '') {
            endIndex = i + 1;
            continue;
        }
        const indent = line.search(/\S/);
        if (indent > parentIndent) {
            endIndex = i + 1;
        } else {
            break;
        }
    }

    // Trim trailing blank lines that were only included speculatively
    while (endIndex > lineIndex + 1 && lines[endIndex - 1].trim() === '') {
        endIndex--;
    }

    const lineCount = endIndex - lineIndex;
    const hasSubtasks = lineCount > 1;

    // Build confirmation message
    let message = 'Are you sure you want to delete "' + taskName + '"?';
    if (hasSubtasks) {
        message += '\n\nThis will also delete ' + (lineCount - 1) + ' subtask line(s) beneath it.';
    }
    message += '\n\nThis cannot be undone.';

    if (!confirm(message)) return;

    // Remove the lines from the editor
    lines.splice(lineIndex, lineCount);
    editor.value = lines.join('\n');

    // Close the form and clear state before triggering re-render
    closeDetailPane();
    currentTaskLineNumber = null;

    // Trigger re-render of the plan
    editor.dispatchEvent(new Event('input'));
    setTimeout(() => renderText(), 10);
}

/**
 * Add a new row to the dependencies table
 */
function addDependencyRow(taskName = '', depType = 'FS', lagLead = '') {
    const tbody = document.getElementById('dependenciesTableBody');
    const row = document.createElement('tr');

    // Create unique ID for this dropdown
    const dropdownId = 'depAutocomplete_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    row.innerHTML = `
        <td>
            <div class="autocomplete-container" style="position: relative;">
                <input type="text" class="dependency-task-name" placeholder="Task name" value="${taskName}"
                       oninput="handleDependencyInput(this)"
                       onkeydown="handleDependencyKeydown(event, this)"
                       autocomplete="off"
                       data-dropdown="${dropdownId}">
                <div id="${dropdownId}" class="autocomplete-dropdown"></div>
            </div>
        </td>
        <td>
            <select class="dependency-type" onchange="saveTask()">
                <option value="FS"${depType === 'FS' ? ' selected' : ''}>FS</option>
                <option value="SS"${depType === 'SS' ? ' selected' : ''}>SS</option>
                <option value="FF"${depType === 'FF' ? ' selected' : ''}>FF</option>
                <option value="SF"${depType === 'SF' ? ' selected' : ''}>SF</option>
            </select>
        </td>
        <td>
            <input type="text" class="dependency-lag-lead" placeholder="e.g., +2d, -1w" value="${lagLead}" oninput="saveTask()">
        </td>
        <td>
            <button type="button" class="remove-dependency-btn" onclick="removeDependencyRow(this)">×</button>
        </td>
    `;

    tbody.appendChild(row);
}

/** Commit the task named in the dependency add box on Enter. */
function handleAddDependencyKeydown(event, input) {
    if (event.key !== 'Enter') {
        handleDependencyKeydown(event, input);
        return;
    }
    event.preventDefault();

    const dropdown = document.getElementById(input.dataset.dropdown);
    const selected = dropdown?.querySelector('.autocomplete-item.selected');
    const typed = (selected ? selected.textContent : input.value).trim();
    if (!typed) return;

    const match = getAllTaskNames().find(name => name.toLowerCase() === typed.toLowerCase());
    if (!match) {
        if (typeof showMessage === 'function') {
            showMessage('editor', 'error', `Unknown dependency task: ${typed}`);
        }
        return;
    }

    addDependencyRow(match);
    input.value = '';
    if (dropdown) dropdown.style.display = 'none';
    dependencyAutocompleteSelectedIndex = -1;
    saveTask();
    input.focus();
}

/**
 * Remove a dependency row from the table
 */
function removeDependencyRow(button) {
    const row = button.closest('tr');
    row.remove();
    saveTask(); // Update the editor after removing a dependency
}

/**
 * Populate dependencies table from task data
 */
function populateDependenciesTable(dependenciesStr) {
    const tbody = document.getElementById('dependenciesTableBody');
    tbody.innerHTML = ''; // Clear existing rows

    if (!dependenciesStr || !dependenciesStr.trim()) {
        return;
    }

    // Parse dependencies string like "Task1, Task2:SS +2d, Task3:FF -1w"
    // This comes from [depends Task1, Task2:SS +2d] syntax
    const deps = dependenciesStr.split(',').map(d => d.trim()).filter(d => d);

    deps.forEach(dep => {
        // Check if this dependency has lag/lead time
        const lagLeadMatch = dep.match(/^(.+?)\s+([+\-]\d+[dwmy])$/);
        let taskName = dep;
        let lagLead = '';
        let depType = 'FS';

        if (lagLeadMatch) {
            taskName = lagLeadMatch[1].trim();
            lagLead = lagLeadMatch[2];
        }

        // Check for dependency type suffix: "TaskName:SS"
        const typeMatch = taskName.match(/^(.+?):(FS|SS|FF|SF)$/i);
        if (typeMatch) {
            taskName = typeMatch[1].trim();
            depType = typeMatch[2].toUpperCase();
        }

        addDependencyRow(taskName, depType, lagLead);
    });

    // If no dependencies, show empty state
    if (deps.length === 0) {
        tbody.innerHTML = '';
    }
}

/**
 * Collect dependencies from table into a string format
 * Returns format like "Task1, Task2 +2d, Task3 -1w"
 */
function collectDependenciesFromTable() {
    const rows = document.querySelectorAll('#dependenciesTableBody tr');
    const deps = [];

    rows.forEach(row => {
        const taskName = row.querySelector('.dependency-task-name').value.trim();
        const depTypeSelect = row.querySelector('.dependency-type');
        const depType = depTypeSelect ? depTypeSelect.value : 'FS';
        const lagLead = row.querySelector('.dependency-lag-lead').value.trim();

        if (taskName) {
            // Only include type suffix if not the default (FS)
            let depStr = taskName;
            if (depType && depType !== 'FS') {
                depStr = `${taskName}:${depType}`;
            }
            if (lagLead) {
                deps.push(`${depStr} ${lagLead}`);
            } else {
                deps.push(depStr);
            }
        }
    });

    return deps.join(', ');
}

let _saveTaskTimer = null;

function saveTaskDebounced() {
    if (_saveTaskTimer) clearTimeout(_saveTaskTimer);
    _saveTaskTimer = setTimeout(function () {
        _saveTaskTimer = null;
        saveTask();
    }, 1000);
}

function saveTask() {
    if (currentTaskLineNumber === null) return;

    // Don't save while openTaskForm is populating fields — form values
    // are in a mixed state (some old, some new) and would corrupt the line
    if (_taskFormPopulating) return;

    // Don't save if the task form is not the active section
    // (prevents stale saves when switching to the product form)
    const taskSection = document.getElementById('taskFormSection');
    if (taskSection && !taskSection.classList.contains('active')) return;

    const editor = document.getElementById('planEditor');
    const lines = editor.value.split('\n');
    const originalLine = lines[currentTaskLineNumber - 1];

    // Safety check - if line doesn't exist, return
    if (!originalLine && originalLine !== '') {
        console.error('Task line not found at line number:', currentTaskLineNumber, 'Total lines:', lines.length);
        return;
    }

    // Get old task name before making changes (for rename detection)
    const oldTaskName = extractTaskNameFromEditorLine(originalLine);

    // Get form values
    const name = document.getElementById('taskName').value.trim();
    const duration = document.getElementById('taskDuration').value.trim();
    const startDate = document.getElementById('taskStartDate').value.trim();
    const finishDate = document.getElementById('taskFinishDate').value.trim();
    const deadlineField = document.getElementById('taskDeadline');
    const deadline = deadlineField ? deadlineField.value.trim() : '';
    const percent = document.getElementById('taskPercent').value.trim();
    const resources = document.getElementById('taskResources').value.trim();
    const comment = document.getElementById('taskComment').value.trim();
    const dependencies = collectDependenciesFromTable();

    // Get previous task name for dependency check
    const previousTaskName = getPreviousTaskName(lines, currentTaskLineNumber);

    // Parse dependencies - split by comma if multiple
    const depList = dependencies ? dependencies.split(',').map(d => d.trim()).filter(d => d) : [];

    // Check for previous task dependency (without lag/lead only)
    // If there's lag/lead, we use [depends] syntax instead of *
    let dependsOnPreviousSimple = false; // Only true if previous task with NO lag/lead
    const allDependenciesForBrackets = []; // All dependencies that need [depends] syntax

    depList.forEach(dep => {
        // Check if this dependency has lag/lead time (complete or incomplete)
        // Complete: +2d, -1w   Incomplete: +, +2, -1
        const lagLeadMatch = dep.match(/^(.+?)\s+([+\-]\d*[dwmy]?)$/);

        if (lagLeadMatch) {
            const taskName = lagLeadMatch[1].trim();
            const lagLeadPart = lagLeadMatch[2];

            // Check if lag/lead is complete (has number AND unit)
            const isCompleteLagLead = /^[+\-]\d+[dwmy]$/.test(lagLeadPart);

            if (isCompleteLagLead) {
                // Complete lag/lead: "Task Name +2d" or "Task Name:SS +2d"
                // Always use [depends] syntax for lag/lead, even if it's the previous task
                allDependenciesForBrackets.push(dep);
            } else {
                // Incomplete lag/lead (e.g., "+", "+2", "2d" without sign)
                // Treat as if no lag/lead, but preserve the string in [depends]
                allDependenciesForBrackets.push(dep);
            }
        } else {
            // No lag/lead - check for dependency type suffix
            const typeMatch = dep.match(/^(.+?):(FS|SS|FF|SF)$/i);
            const bareTaskName = typeMatch ? typeMatch[1].trim() : dep;
            const hasNonDefaultType = typeMatch && typeMatch[2].toUpperCase() !== 'FS';

            if (bareTaskName === previousTaskName && !hasNonDefaultType) {
                // Simple FS dependency on previous task - use * notation
                dependsOnPreviousSimple = true;
            } else {
                // Other task or non-default type - use [depends] syntax
                allDependenciesForBrackets.push(dep);
            }
        }
    });

    // Reconstruct task line
    let indent = '';
    try {
        const indentMatch = originalLine.match(/^\s*/);
        if (indentMatch && indentMatch[0] !== undefined) {
            indent = indentMatch[0];
        } else {
            console.error('Regex match failed for originalLine:', originalLine);
        }
    } catch (e) {
        console.error('Error matching indent:', e, 'originalLine:', originalLine, 'type:', typeof originalLine);
    }

    let taskNamePart = dependsOnPreviousSimple ? '*' + name : name;
    let newLine = indent + taskNamePart;

    // Preserve $deliverable token (with product type prefix) from original line
    const deliverableMatch = originalLine.match(/[/^]?\$[A-Za-z_][A-Za-z0-9_-]*/);
    if (deliverableMatch) {
        newLine += ' ' + deliverableMatch[0];
    }

    // Add duration
    if (duration) newLine += ' ' + duration + 'd';

    // Add effort
    const effortCompleted = document.getElementById('taskEffortCompleted').value.trim();
    const effortRemaining = document.getElementById('taskEffortRemaining').value.trim();
    const effortCompletedUnit = document.getElementById('taskEffortCompletedUnit').value;
    const effortRemainingUnit = document.getElementById('taskEffortRemainingUnit').value;
    const completedNum = parseFloat(effortCompleted) || 0;
    const remainingNum = parseFloat(effortRemaining) || 0;

    if (completedNum > 0 || remainingNum > 0) {
        const totalNum = completedNum + remainingNum;
        // Use the remaining unit for total (or completed unit if no remaining)
        const totalUnit = remainingNum > 0 ? effortRemainingUnit : effortCompletedUnit;

        if (completedNum > 0) {
            // Format: ~completed/total (e.g., ~8h/16h)
            const completedStr = Number.isInteger(completedNum) ? String(completedNum) : String(completedNum);
            const totalStr = Number.isInteger(totalNum) ? String(totalNum) : String(totalNum);
            newLine += ' ~' + completedStr + effortCompletedUnit + '/' + totalStr + totalUnit;
        } else {
            // Format: ~total (e.g., ~16h) - no completed yet
            const totalStr = Number.isInteger(totalNum) ? String(totalNum) : String(totalNum);
            newLine += ' ~' + totalStr + totalUnit;
        }
    }

    // Add resources - split by comma and add @ prefix to each
    if (resources) {
        const resourceList = resources.split(',').map(r => r.trim()).filter(r => r);
        resourceList.forEach(resource => {
            newLine += ' @' + resource;
        });
    }

    // Add percent - but only if this is not a summary task
    // Summary tasks have their percent auto-calculated from subtasks
    // Effort-driven tasks should still emit percent (it's derived from effort data)
    const percentInput = document.getElementById('taskPercent');
    const isSummaryTask = percentInput && percentInput.dataset.isSummary === 'true';
    if (percent && !isSummaryTask) newLine += ' ' + percent + '%';

    // Add dates (ISO format) - only if user explicitly set them
    if (startDate && userSetStartDate) newLine += ' ' + startDate;
    if (finishDate && userSetFinishDate) newLine += ' ' + finishDate;

    // Add deadline (D-prefixed, never auto-calculated -- see #877)
    if (deadline) newLine += ' D' + deadline;

    // Add priority marker
    const prioritySelect = document.getElementById('taskPriority');
    if (prioritySelect) {
        const priority = prioritySelect.value;
        const priorityMarkers = { 'Urgent': '!!!', 'Important': '!!', 'Medium': '!' };
        if (priorityMarkers[priority]) {
            newLine += ' ' + priorityMarkers[priority];
        }
    }

    // Add bucket
    const bucketInput = document.getElementById('taskBucket');
    if (bucketInput) {
        const bucket = bucketInput.value.trim();
        if (bucket) {
            newLine += ' {' + bucket + '}';
        }
    }

    // Add comment
    if (comment) newLine += ' "' + comment + '"';

    // Add dependencies - use [depends] syntax for all non-simple dependencies
    // (includes lag/lead dependencies, even if it's the previous task)
    if (allDependenciesForBrackets.length > 0) {
        newLine += ' [depends ' + allDependenciesForBrackets.join(', ') + ']';
    }

    // Add labels (if labels field exists in form)
    const labelsInput = document.getElementById('taskLabels');
    if (labelsInput) {
        const labels = labelsInput.value.trim();
        if (labels) {
            const labelList = labels.split(',').map(l => l.trim()).filter(l => l);
            labelList.forEach(label => {
                newLine += ' #' + label;
            });
        }
    }

    // Add recurrence
    const recurrenceInput = document.getElementById('taskRecurrence');
    if (recurrenceInput) {
        const recurrenceVal = buildRecurrenceString();
        if (recurrenceVal) {
            newLine += ' [repeats ' + recurrenceVal + ']';
        }
    }

    let newPlanText;
    if (typeof NoodlePlanModel !== 'undefined') {
        let model = NoodlePlanModel.modelForEditor(editor);
        let node = model.tasks.find(task => model.lineNumber(task) === currentTaskLineNumber);
        if (node) {
            // Rename first while dependency edges still point at this object;
            // serialising the graph updates every predecessor reference.
            if (oldTaskName && name && oldTaskName !== name) {
                model.rename(node, name);
                model = NoodlePlanModel.PlanModel.parse(model.serialize());
                node = model.findById(node.id);
            }
            model.updateLine(node, () => newLine);
            newPlanText = model.serialize();
        } else {
            lines[currentTaskLineNumber - 1] = newLine;
            newPlanText = lines.join('\n');
        }
    } else {
        lines[currentTaskLineNumber - 1] = newLine;
        if (oldTaskName && name && oldTaskName !== name) {
            updateDependencyReferences(lines, oldTaskName, name);
        }
        newPlanText = lines.join('\n');
    }

    // Auto-update the task's whiteboard row(s), if any (issue #844). A
    // no-op unless the plan has a whiteboard row for this task name --
    // whiteboard rows only ever reference summary tasks, but renaming a
    // non-summary task here costs nothing extra to check.
    if (oldTaskName && name && oldTaskName !== name && typeof renamePlanWhiteboardTask === 'function') {
        newPlanText = renamePlanWhiteboardTask(newPlanText, oldTaskName, name);
    }

    editor.value = newPlanText;

    // Trigger input event to update line numbers and render
    // (the editor's own input handler debounces renderText at 1s)
    editor.dispatchEvent(new Event('input'));
}

/**
 * Populate the recurrence form fields from a recurrence string.
 * Recurrence strings: 'daily', 'weekly mon,wed,fri', 'monthly 3rd thu', 'yearly'
 */
function populateRecurrenceForm(recurrenceStr) {
    const freqSelect = document.getElementById('taskRecurrence');
    const weeklyOptions = document.getElementById('recurrenceWeeklyOptions');
    const monthlyOptions = document.getElementById('recurrenceMonthlyOptions');

    if (!freqSelect) return;

    // Reset all options
    freqSelect.value = '';
    if (weeklyOptions) weeklyOptions.style.display = 'none';
    if (monthlyOptions) monthlyOptions.style.display = 'none';

    // Uncheck all day checkboxes
    const dayCheckboxes = document.querySelectorAll('.recurrence-day-checkbox');
    dayCheckboxes.forEach(cb => { cb.checked = false; });

    if (!recurrenceStr) return;

    const str = recurrenceStr.trim().toLowerCase();

    if (str === 'daily') {
        freqSelect.value = 'daily';
    } else if (str === 'yearly') {
        freqSelect.value = 'yearly';
    } else if (str.startsWith('weekly')) {
        freqSelect.value = 'weekly';
        if (weeklyOptions) weeklyOptions.style.display = '';
        const daysPart = str.replace(/^weekly\s*/, '');
        if (daysPart) {
            const days = daysPart.split(',').map(d => d.trim());
            days.forEach(day => {
                const cb = document.getElementById('recDay_' + day);
                if (cb) cb.checked = true;
            });
        }
    } else if (str.startsWith('monthly')) {
        freqSelect.value = 'monthly';
        if (monthlyOptions) monthlyOptions.style.display = '';
        const monthlyPart = str.replace(/^monthly\s*/, '');
        const match = monthlyPart.match(/(\d+(?:st|nd|rd|th))\s+(\w+)/);
        if (match) {
            const ordinalSel = document.getElementById('recurrenceWeekOfMonth');
            const daySel = document.getElementById('recurrenceDayOfWeek');
            if (ordinalSel) ordinalSel.value = match[1];
            if (daySel) daySel.value = match[2];
        }
    }
}

/**
 * Build a recurrence string from the current form state.
 * Returns empty string if no recurrence is set.
 */
function buildRecurrenceString() {
    const freqSelect = document.getElementById('taskRecurrence');
    if (!freqSelect || !freqSelect.value) return '';

    const freq = freqSelect.value;

    if (freq === 'daily') return 'daily';
    if (freq === 'yearly') return 'yearly';

    if (freq === 'weekly') {
        const checkedDays = [];
        const dayCheckboxes = document.querySelectorAll('.recurrence-day-checkbox:checked');
        dayCheckboxes.forEach(cb => checkedDays.push(cb.value));
        if (checkedDays.length > 0) {
            return 'weekly ' + checkedDays.join(',');
        }
        return 'weekly';
    }

    if (freq === 'monthly') {
        const ordinalSel = document.getElementById('recurrenceWeekOfMonth');
        const daySel = document.getElementById('recurrenceDayOfWeek');
        const ordinal = ordinalSel ? ordinalSel.value : '1st';
        const day = daySel ? daySel.value : 'mon';
        return 'monthly ' + ordinal + ' ' + day;
    }

    return '';
}

/**
 * Handle changes to the recurrence frequency selector.
 * Shows/hides sub-options based on the chosen frequency.
 */
function onRecurrenceFrequencyChange() {
    const freqSelect = document.getElementById('taskRecurrence');
    const weeklyOptions = document.getElementById('recurrenceWeeklyOptions');
    const monthlyOptions = document.getElementById('recurrenceMonthlyOptions');

    if (!freqSelect) return;

    if (weeklyOptions) weeklyOptions.style.display = freqSelect.value === 'weekly' ? '' : 'none';
    if (monthlyOptions) monthlyOptions.style.display = freqSelect.value === 'monthly' ? '' : 'none';

    saveTask();
}

/**
 * Format a recurrence string into a human-readable label.
 * e.g. 'weekly mon,wed,fri' -> 'Weekly: Mon, Wed, Fri'
 */
function formatRecurrenceLabel(recurrenceStr) {
    if (!recurrenceStr) return '';
    const str = recurrenceStr.trim().toLowerCase();
    if (str === 'daily') return 'Daily';
    if (str === 'yearly') return 'Yearly';
    if (str.startsWith('weekly')) {
        const daysPart = str.replace(/^weekly\s*/, '');
        if (!daysPart) return 'Weekly';
        const days = daysPart.split(',').map(d => d.charAt(0).toUpperCase() + d.slice(1));
        return 'Weekly: ' + days.join(', ');
    }
    if (str.startsWith('monthly')) {
        const rest = str.replace(/^monthly\s*/, '');
        if (!rest) return 'Monthly';
        const match = rest.match(/(\d+(?:st|nd|rd|th))\s+(\w+)/);
        if (match) {
            const ordinal = match[1].charAt(0).toUpperCase() + match[1].slice(1);
            const day = match[2].charAt(0).toUpperCase() + match[2].slice(1);
            return 'Monthly: ' + ordinal + ' ' + day;
        }
        return 'Monthly';
    }
    return str;
}

/**
 * Generate virtual recurring task occurrences within a date window.
 * Returns array of task-like objects for each occurrence.
 */
function generateRecurrenceOccurrences(task, windowStart, windowEnd) {
    const recurrence = task.recurrence;
    if (!recurrence) return [];

    const dayNameToWeekday = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };
    const occurrences = [];
    const str = recurrence.trim().toLowerCase();

    let frequency = '';
    if (str === 'daily') frequency = 'daily';
    else if (str === 'yearly') frequency = 'yearly';
    else if (str.startsWith('weekly')) frequency = 'weekly';
    else if (str.startsWith('monthly')) frequency = 'monthly';

    const addOccurrence = (date) => {
        occurrences.push(Object.assign({}, task, {
            start: date.toISOString().split('T')[0],
            finish: date.toISOString().split('T')[0],
            is_recurring_instance: true,
            recurrence_date: date.toISOString().split('T')[0]
        }));
    };

    if (frequency === 'daily') {
        let current = new Date(windowStart);
        while (current <= windowEnd) {
            addOccurrence(new Date(current));
            current.setDate(current.getDate() + 1);
        }
    } else if (frequency === 'weekly') {
        const daysPart = str.replace(/^weekly\s*/, '');
        let targetWeekdays = new Set();
        if (daysPart) {
            daysPart.split(',').forEach(d => {
                const wd = dayNameToWeekday[d.trim()];
                if (wd !== undefined) targetWeekdays.add(wd);
            });
        }
        let current = new Date(windowStart);
        while (current <= windowEnd) {
            if (targetWeekdays.size === 0 || targetWeekdays.has(current.getDay())) {
                addOccurrence(new Date(current));
            }
            current.setDate(current.getDate() + 1);
        }
    } else if (frequency === 'monthly') {
        const monthlyPart = str.replace(/^monthly\s*/, '');
        const match = monthlyPart.match(/(\d+)(?:st|nd|rd|th)\s+(\w+)/);
        if (match) {
            const weekOfMonth = parseInt(match[1]);
            const targetWeekday = dayNameToWeekday[match[2]];
            if (targetWeekday !== undefined) {
                let year = windowStart.getFullYear();
                let month = windowStart.getMonth();
                const endYear = windowEnd.getFullYear();
                const endMonth = windowEnd.getMonth();

                while (year < endYear || (year === endYear && month <= endMonth)) {
                    // Find nth occurrence of target weekday in this month
                    const firstDay = new Date(year, month, 1);
                    const daysInMonth = new Date(year, month + 1, 0).getDate();
                    let count = 0;
                    for (let d = 1; d <= daysInMonth; d++) {
                        const date = new Date(year, month, d);
                        if (date.getDay() === targetWeekday) {
                            count++;
                            if (count === weekOfMonth) {
                                if (date >= windowStart && date <= windowEnd) {
                                    addOccurrence(date);
                                }
                                break;
                            }
                        }
                    }
                    month++;
                    if (month > 11) { month = 0; year++; }
                }
            }
        }
    } else if (frequency === 'yearly') {
        // Use the task's start date month/day and repeat each year in window
        if (task.start) {
            const taskStart = new Date(task.start + 'T00:00:00');
            for (let yr = windowStart.getFullYear(); yr <= windowEnd.getFullYear(); yr++) {
                try {
                    const occurrence = new Date(yr, taskStart.getMonth(), taskStart.getDate());
                    if (occurrence >= windowStart && occurrence <= windowEnd) {
                        addOccurrence(occurrence);
                    }
                } catch (e) { /* skip invalid dates */ }
            }
        }
    }

    return occurrences;
}

/**
 * Update all dependency references in the editor when a task is renamed.
 * Scans all lines for [depends ...] blocks containing the old name and
 * replaces them with the new name, handling comma-separated lists and
 * lag/lead suffixes (e.g., "OldName +2d" becomes "NewName +2d").
 */
function updateDependencyReferences(lines, oldName, newName) {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!/\[depends(?::\s*|\s+)[^\]]+\]/i.test(line)) continue;

        lines[i] = line.replace(/\[depends(?::\s*|\s+)([^\]]+)\]/gi, function(match, depsContent) {
            const deps = depsContent.split(',').map(d => d.trim());
            let changed = false;

            const updatedDeps = deps.map(dep => {
                // Check for exact match (with optional type suffix and lag/lead suffix)
                // e.g., "OldName", "OldName:SS", "OldName +2d", "OldName:SS +2d"
                const lagLeadMatch = dep.match(/^(.+?)\s+([+\-]\d*[dwmy]?)$/);
                let corePart = lagLeadMatch ? lagLeadMatch[1].trim() : dep;
                let lagLead = lagLeadMatch ? lagLeadMatch[2] : '';

                // Check for dependency type suffix
                const typeMatch = corePart.match(/^(.+?):(FS|SS|FF|SF)$/i);
                let taskName = typeMatch ? typeMatch[1].trim() : corePart;
                let typeSuffix = typeMatch ? ':' + typeMatch[2] : '';

                if (taskName === oldName) {
                    changed = true;
                    let result = newName + typeSuffix;
                    if (lagLead) result += ' ' + lagLead;
                    return result;
                }

                return dep;
            });

            if (changed) {
                return '[depends ' + updatedDeps.join(', ') + ']';
            }
            return match;
        });
    }
}

/**
 * Update all dependency references in the editor when a $deliverable identifier
 * is renamed.  Scans all lines for [depends ...] blocks containing $oldId and
 * replaces them with $newId, handling comma-separated lists and lag/lead or
 * type suffixes (e.g., "$oldId:SS +2d" becomes "$newId:SS +2d").
 */
function updateDeliverableReferences(lines, oldId, newId) {
    const oldToken = '$' + oldId;
    const newToken = '$' + newId;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!/\[depends(?::\s*|\s+)[^\]]+\]/i.test(line)) continue;

        lines[i] = line.replace(/\[depends(?::\s*|\s+)([^\]]+)\]/gi, function(match, depsContent) {
            const deps = depsContent.split(',').map(d => d.trim());
            let changed = false;

            const updatedDeps = deps.map(dep => {
                // Strip optional lag/lead suffix  e.g. "$foo +2d"
                const lagLeadMatch = dep.match(/^(.+?)\s+([+\-]\d*[dwmy]?)$/);
                let corePart = lagLeadMatch ? lagLeadMatch[1].trim() : dep;
                let lagLead = lagLeadMatch ? lagLeadMatch[2] : '';

                // Strip optional dependency type suffix  e.g. "$foo:SS"
                const typeMatch = corePart.match(/^(.+?):(FS|SS|FF|SF)$/i);
                let depName = typeMatch ? typeMatch[1].trim() : corePart;
                let typeSuffix = typeMatch ? ':' + typeMatch[2] : '';

                if (depName === oldToken) {
                    changed = true;
                    let result = newToken + typeSuffix;
                    if (lagLead) result += ' ' + lagLead;
                    return result;
                }

                return dep;
            });

            if (changed) {
                return '[depends ' + updatedDeps.join(', ') + ']';
            }
            return match;
        });
    }
}

/**
 * Check if a line in the plan is a summary task (phase/parent).
 * A summary task is a non-empty line that has a subsequent non-empty line
 * with greater indentation (i.e., it has children).
 */
function isSummaryLine(lines, lineIndex) {
    const line = lines[lineIndex];
    if (!line || !line.trim()) return false;

    const indent = line.search(/\S/);
    if (indent < 0) return false;

    // Look ahead for the next non-empty line
    for (let j = lineIndex + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        const nextTrimmed = nextLine.trim();
        if (!nextTrimmed) continue; // Skip blank lines

        const nextIndent = nextLine.search(/\S/);
        // If the next non-empty line is more indented, this is a summary task
        return nextIndent > indent;
    }

    // No subsequent non-empty line found - not a summary
    return false;
}

function getPreviousTaskName(lines, currentLineNum) {
    // Look backwards from current line to find the previous non-summary task
    for (let i = currentLineNum - 2; i >= 0; i--) {
        const line = lines[i].trim();
        // Skip empty lines, phase headers, and summary lines
        if (line && !line.includes('===') && !line.includes('---') && !line.startsWith('#')) {
            // Skip summary tasks (phases that have children)
            if (isSummaryLine(lines, i)) continue;

            // Parse this line to get just the task name
            const task = parseTaskLine(line, i + 1);
            if (task.name) {
                return task.name;
            }
        }
    }
    return null;
}

function parseTaskLine(line, lineNum) {
    const parsed = TaskLineTokenizer.metadata(line);
    const values = parsed.values;
    const task = {
        lineNumber: lineNum,
        name: values.name,
        duration: values.duration,
        startDate: values.startDate,
        finishDate: values.finishDate,
        deadline: values.deadline,
        percent: values.percent,
        resources: values.resources.join(', '),
        comment: values.comment,
        priority: values.priority,
        bucket: values.bucket,
        dependencies: values.dependencies.join(', '),
        labels: values.labels.join(', '),
        recurrence: values.recurrence,
        effortCompleted: values.effortCompleted,
        effortCompletedUnit: values.effortCompletedUnit,
        effortRemaining: values.effortRemaining,
        effortRemainingUnit: values.effortRemainingUnit,
        effortTotal: values.effortTotal,
        effortTotalUnit: values.effortTotalUnit
    };
    if (values.product_type) {
        task.product_type = values.product_type;
        task.deliverable = values.deliverable;
    }
    if (values.hasStar) {
        const editor = document.getElementById('planEditor');
        if (editor) {
            const previousTaskName = getPreviousTaskName(editor.value.split('\n'), lineNum);
            if (previousTaskName) {
                task.dependencies = [values.starLagLead ? `${previousTaskName} ${values.starLagLead}` : previousTaskName,
                    ...values.dependencies].join(', ');
            }
        }
    }
    return task;

    /*
    const legacyTask = {
        lineNumber: lineNum,
        name: '',
        duration: '',
        startDate: '',
        finishDate: '',
        percent: '',
        resources: '',
        comment: '',
        priority: 'Low',
        bucket: '',
        dependencies: '',
        labels: '',
        recurrence: '',
        effortCompleted: '',
        effortCompletedUnit: 'h',
        effortRemaining: '',
        effortRemainingUnit: 'h',
        effortTotal: '',
        effortTotalUnit: 'h'
    };

    // Remove leading whitespace
    const trimmed = line.trim();
    if (!trimmed) return task;

    // Check for * prefix (depends on previous task)
    let hasStar = false;
    let starLagLead = ''; // Capture lag/lead after *
    let text = trimmed;
    if (text.startsWith('*')) {
        hasStar = true;
        text = text.substring(1).trim();

        // Check if there's a lag/lead time immediately after the *
        // Pattern: * +2d TaskName or * -1w TaskName
        const starLagMatch = text.match(/^([+\-]\d+[dwmy])\s+/);
        if (starLagMatch) {
            starLagLead = starLagMatch[1];
            text = text.substring(starLagMatch[0].length).trim();
        }
    }

    // Handle effort syntax: ~8h, ~3d, ~8h/16h, ~2d/5d
    let effortMatch = text.match(/~(\d+(?:\.\d+)?)(h|d)(?:\/(\d+(?:\.\d+)?)(h|d))?/);
    if (effortMatch) {
        if (effortMatch[3] !== undefined) {
            // Format: ~completed/total
            task.effortCompleted = effortMatch[1];
            task.effortCompletedUnit = effortMatch[2];
            task.effortTotal = effortMatch[3];
            task.effortTotalUnit = effortMatch[4];
            const total = parseFloat(effortMatch[3]);
            const completed = parseFloat(effortMatch[1]);
            task.effortRemaining = String(total - completed);
            task.effortRemainingUnit = effortMatch[4];
        } else {
            // Format: ~total only
            task.effortCompleted = '0';
            task.effortCompletedUnit = effortMatch[2];
            task.effortTotal = effortMatch[1];
            task.effortTotalUnit = effortMatch[2];
            task.effortRemaining = effortMatch[1];
            task.effortRemainingUnit = effortMatch[2];
        }
        text = text.replace(/~\d+(?:\.\d+)?[hd](?:\/\d+(?:\.\d+)?[hd])?/, '').trim();

        // Auto-calculate percent from effort
        const effortCompleted = parseFloat(task.effortCompleted) || 0;
        const effortTotal = parseFloat(task.effortTotal) || 0;
        if (effortTotal > 0) {
            const cUnit = task.effortCompletedUnit || 'h';
            const tUnit = task.effortTotalUnit || 'h';
            const completedHours = cUnit === 'd' ? effortCompleted * 8 : effortCompleted;
            const totalHours = tUnit === 'd' ? effortTotal * 8 : effortTotal;
            if (totalHours > 0) {
                task.percent = String(Math.max(0, Math.min(100, Math.round(completedHours / totalHours * 100))));
            }
        }
    }

    // Handle comment first (everything in quotes)
    let comment = '';
    const quoteMatch = text.match(/"([^"]*)"/);
    if (quoteMatch) {
        comment = quoteMatch[1];
        // Remove the comment from the text
        text = text.replace(/"[^"]*"/, '').trim();
    }

    // Handle bucket (text in curly braces {BucketName})
    const bucketMatch = text.match(/\{([^}]+)\}/);
    if (bucketMatch) {
        task.bucket = bucketMatch[1].trim();
        text = text.replace(/\{[^}]+\}/, '').trim();
    }

    // Handle priority markers (!!!=Urgent, !!=Important, !=Medium)
    // Must check longest first; avoid matching !"comment" patterns
    const priorityMatch = text.match(/(?<!\w)(!!!|!!|!)(?!["'{])/);
    if (priorityMatch) {
        const marker = priorityMatch[1];
        if (marker === '!!!') task.priority = 'Urgent';
        else if (marker === '!!') task.priority = 'Important';
        else if (marker === '!') task.priority = 'Medium';
        text = text.replace(/(?<!\w)(!!!|!!|!)(?!["'{])/, '').trim();
    }

    // Handle recurrence ([repeats daily], [repeats weekly mon,wed], [repeats monthly 3rd thu], [repeats yearly])
    const repeatsMatch = text.match(/\[repeats\s+([^\]]+)\]/i);
    if (repeatsMatch) {
        task.recurrence = repeatsMatch[1].trim().toLowerCase();
        text = text.replace(/\[repeats\s+[^\]]+\]/i, '').trim();
    }

    // Handle dependencies (everything in square brackets [depends ...])
    const dependencies = [];
    const dependsMatch = text.match(/\[depends(?::\s*|\s+)([^\]]+)\]/i);
    if (dependsMatch) {
        // Parse dependencies - can be comma-separated
        const depText = dependsMatch[1];
        dependencies.push(...depText.split(',').map(d => d.trim()).filter(d => d));
        // Remove the dependency from the text
        text = text.replace(/\[depends(?::\s*|\s+)[^\]]+\]/i, '').trim();
    }

    // Split by spaces to get tokens
    const tokens = text.split(/\s+/);

    const nameTokens = [];
    const resources = [];
    const labels = [];
    const dates = [];

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        // Skip empty tokens
        if (!token) continue;

        // Check what type of token this is
        if (token.startsWith('@')) {
            // Resource: @kev, @jen
            resources.push(token.substring(1));
        }
        else if (token.startsWith('#')) {
            // Label/Tag: #DEV, #HIGH
            labels.push(token.substring(1));
        }
        else if (token.match(/^\d+[dmw]$/)) {
            // Duration: 5d, 2w, 3m
            const num = token.match(/^(\d+)/)[1];
            task.duration = num;
        }
        else if (token.match(/^\d+%$/)) {
            // Percent: 50%
            const num = token.match(/^(\d+)/)[1];
            task.percent = num;
        }
        else if (token.match(/^\d{4}-\d{2}-\d{2}$/)) {
            // ISO Date: 2025-11-11
            dates.push(token);
        }
        else if (token.match(/^[/^]?\$[A-Za-z_]/)) {
            // Deliverable marker: $fuselage, /$group, ^$external
            if (token.startsWith('/')) {
                task.product_type = 'group';
                task.deliverable = token.substring(2); // strip /$
            } else if (token.startsWith('^')) {
                task.product_type = 'external';
                task.deliverable = token.substring(2); // strip ^$
            } else {
                task.product_type = 'internal';
                task.deliverable = token.substring(1); // strip $
            }
        }
        else {
            // Part of task name
            nameTokens.push(token);
        }
    }

    // Assemble the results
    task.name = nameTokens.join(' ');
    task.comment = comment;
    task.resources = resources.join(', ');

    // Handle dates
    if (dates.length > 0) {
        task.startDate = dates[0];
        if (dates.length > 1) {
            task.finishDate = dates[1];
        }
    }

    // Handle dependencies
    if (hasStar) {
        // Add previous task as dependency (with lag/lead if present)
        const editor = document.getElementById('planEditor');
        if (editor) {
            const lines = editor.value.split('\n');
            const previousTaskName = getPreviousTaskName(lines, lineNum);
            if (previousTaskName) {
                const prevDep = starLagLead ? `${previousTaskName} ${starLagLead}` : previousTaskName;
                dependencies.unshift(prevDep);
            }
        }
    }

    task.dependencies = dependencies.join(', ');
    task.labels = labels.join(', ');

    return task;
    */
}

/**
 * Parse front matter from plan text to extract resource mappings
 * Returns an object mapping lowercase shortnames to full names
 * Example: { "kev": "Kevin McAleer", "jen": "Jennifer" }
 */
function parseResourceMappings(planText) {
    const resourceMap = {};
    const lines = planText.split('\n');
    let inFrontMatter = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Detect front matter boundaries
        if (line.trim() === '---') {
            if (!inFrontMatter) {
                inFrontMatter = true;
            } else {
                // End of front matter
                break;
            }
            continue;
        }

        // Parse resources in front matter: - @kev: Kevin McAleer, role
        if (inFrontMatter && line.trim().match(/^-\s*@(\w+):\s*(.+)/)) {
            const match = line.trim().match(/^-\s*@(\w+):\s*(.+)/);
            if (match) {
                const shortname = match[1].toLowerCase(); // Normalize to lowercase
                const fullInfo = match[2].trim();
                // Extract just the name (before comma if present)
                const fullName = fullInfo.split(',')[0].trim();
                resourceMap[shortname] = fullName;
            }
        }
    }

    return resourceMap;
}

/**
 * Parse resource details from front matter including name and role.
 * Returns an object mapping lowercase shortnames to { name, role }.
 * Example: { "kev": { name: "Kevin McAleer", role: "Developer" } }
 */
function parseResourceDetails(planText) {
    const details = {};
    const lines = planText.split('\n');
    let inFrontMatter = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.trim() === '---') {
            if (!inFrontMatter) {
                inFrontMatter = true;
            } else {
                break;
            }
            continue;
        }

        if (inFrontMatter && line.trim().match(/^-\s*@(\w+):\s*(.+)/)) {
            const match = line.trim().match(/^-\s*@(\w+):\s*(.+)/);
            if (match) {
                const shortname = match[1].toLowerCase();
                const fullInfo = match[2].trim();
                const parts = fullInfo.split(',').map(p => p.trim());
                const name = parts[0];
                const role = parts.length > 1 ? parts[1] : '';
                // The third field is the email, which the format has always
                // carried (`- @short: Full Name, Role, email, allocation%,
                // non-working [...]`) and this parser used to drop. #1199's
                // resource smarttag shows it on the hover profile card.
                const email = parts.length > 2 ? parts[2] : '';
                details[shortname] = { name, role, email, shortname };
            }
        }
    }

    return details;
}

// Autocomplete functionality for dependencies and resources
// Autocomplete state is now in state.js

function getAllTaskNames() {
    const editor = document.getElementById('planEditor');
    if (!editor) return [];

    const lines = editor.value.split('\n');
    const taskNames = [];
    let inFrontMatter = false;
    let inHighlights = false;
    let inRaidLog = false;
    let inBaseline = false;
    let inBudgetSec = false;
    let inWhiteboard = false;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();

        // Track section boundaries
        if (trimmed === '---') { inFrontMatter = !inFrontMatter; continue; }
        if (trimmed === '---highlights---') { inHighlights = true; continue; }
        if (trimmed === '---end-highlights---' || (inHighlights && (trimmed === '---raid log---' || trimmed === '---budget---'))) { inHighlights = false; }
        if (trimmed === '---budget---') { inBudgetSec = true; continue; }
        if (inBudgetSec && trimmed === '---raid log---') { inBudgetSec = false; }
        if (trimmed === '---raid log---') { inRaidLog = true; continue; }
        if (trimmed === '---baseline---') { inBaseline = true; continue; }
        if (trimmed === '---whiteboard---') { inWhiteboard = true; continue; }

        // Skip non-task content
        if (inFrontMatter || inHighlights || inRaidLog || inBaseline || inBudgetSec || inWhiteboard) continue;
        if (!trimmed || trimmed.startsWith('#') || trimmed.includes('===')) continue;

        const task = parseTaskLine(lines[i], i + 1);
        if (task.name && task.name.trim()) {
            // Don't include the current task being edited
            if (currentTaskLineNumber && task.lineNumber === currentTaskLineNumber) {
                continue;
            }
            // Don't include summary tasks (phases) as valid dependency targets
            if (isSummaryLine(lines, i)) {
                continue;
            }
            taskNames.push(task.name.trim());
        }
    }

    return taskNames;
}

function handleDependencyInput() {
    const input = document.getElementById('taskDependencies');
    const dropdown = document.getElementById('dependencyAutocomplete');
    const value = input.value;

    // Get the current word being typed (after the last comma)
    const lastCommaIndex = value.lastIndexOf(',');
    const currentWord = value.substring(lastCommaIndex + 1).trim();

    if (currentWord.length === 0) {
        dropdown.style.display = 'none';
        autocompleteSelectedIndex = -1;
        saveTask();
        return;
    }

    // Get all task names and filter by current word
    const allTasks = getAllTaskNames();
    const matches = allTasks.filter(name =>
        name.toLowerCase().includes(currentWord.toLowerCase())
    );

    if (matches.length === 0) {
        dropdown.style.display = 'none';
        autocompleteSelectedIndex = -1;
        saveTask();
        return;
    }

    // Build dropdown HTML
    dropdown.innerHTML = '';
    matches.forEach((name, index) => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.textContent = name;
        item.onclick = function() {
            selectDependency(name);
        };
        dropdown.appendChild(item);
    });

    dropdown.style.display = 'block';
    autocompleteSelectedIndex = -1;
    saveTask();
}

function handleDependencyKeydown(event) {
    const dropdown = document.getElementById('dependencyAutocomplete');
    if (dropdown.style.display !== 'block') return;

    const items = dropdown.querySelectorAll('.autocomplete-item');
    if (items.length === 0) return;

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        autocompleteSelectedIndex = Math.min(autocompleteSelectedIndex + 1, items.length - 1);
        updateAutocompleteSelection(items);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        autocompleteSelectedIndex = Math.max(autocompleteSelectedIndex - 1, -1);
        updateAutocompleteSelection(items);
    } else if (event.key === 'Enter') {
        event.preventDefault();
        if (autocompleteSelectedIndex >= 0) {
            const selectedItem = items[autocompleteSelectedIndex];
            selectDependency(selectedItem.textContent);
        }
    } else if (event.key === 'Escape') {
        dropdown.style.display = 'none';
        autocompleteSelectedIndex = -1;
    }
}

function updateAutocompleteSelection(items) {
    items.forEach((item, index) => {
        if (index === autocompleteSelectedIndex) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('selected');
        }
    });
}

function selectDependency(name) {
    const input = document.getElementById('taskDependencies');
    const value = input.value;

    // Replace the current word being typed with the selected name
    const lastCommaIndex = value.lastIndexOf(',');
    let newValue;
    if (lastCommaIndex >= 0) {
        newValue = value.substring(0, lastCommaIndex + 1) + ' ' + name;
    } else {
        newValue = name;
    }

    input.value = newValue;
    const dropdown = document.getElementById('dependencyAutocomplete');
    dropdown.style.display = 'none';
    autocompleteSelectedIndex = -1;
    input.focus();
    saveTask();
}

// Autocomplete functionality for resources
function getAllResourceNames() {
    const editor = document.getElementById('planEditor');
    if (!editor) return [];

    // Get resource mappings from front matter
    const resourceMap = parseResourceMappings(editor.value);

    // If front matter defines resources, use those (lowercase shortnames)
    if (Object.keys(resourceMap).length > 0) {
        return Object.keys(resourceMap).sort();
    }

    // Fallback: collect resources from existing tasks
    const lines = editor.value.split('\n');
    const resourceSet = new Set();

    for (let i = 0; i < lines.length; i++) {
        const task = parseTaskLine(lines[i], i + 1);
        if (task.resources) {
            // Split resources by comma and normalize to lowercase
            const resources = task.resources.split(',').map(r => r.trim().toLowerCase()).filter(r => r);
            resources.forEach(r => resourceSet.add(r));
        }
    }

    return Array.from(resourceSet).sort();
}

function handleResourceInput() {
    const input = document.getElementById('taskResources');
    const dropdown = document.getElementById('resourceAutocomplete');
    const value = input.value;

    // Get the current word being typed (after the last comma)
    const lastCommaIndex = value.lastIndexOf(',');
    const currentWord = value.substring(lastCommaIndex + 1).trim();

    if (currentWord.length === 0) {
        dropdown.style.display = 'none';
        resourceAutocompleteSelectedIndex = -1;
        saveTask();
        return;
    }

    // Get all resource names and filter by current word
    const allResources = getAllResourceNames();
    const matches = allResources.filter(name =>
        name.toLowerCase().includes(currentWord.toLowerCase())
    );

    if (matches.length === 0) {
        dropdown.style.display = 'none';
        resourceAutocompleteSelectedIndex = -1;
        saveTask();
        return;
    }

    // Build dropdown HTML
    dropdown.innerHTML = '';
    matches.forEach((name, index) => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.textContent = name;
        item.onclick = function() {
            selectResource(name);
        };
        dropdown.appendChild(item);
    });

    dropdown.style.display = 'block';
    resourceAutocompleteSelectedIndex = -1;
    saveTask();
}

function handleResourceKeydown(event) {
    const dropdown = document.getElementById('resourceAutocomplete');
    if (dropdown.style.display !== 'block') return;

    const items = dropdown.querySelectorAll('.autocomplete-item');
    if (items.length === 0) return;

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        resourceAutocompleteSelectedIndex = Math.min(resourceAutocompleteSelectedIndex + 1, items.length - 1);
        updateResourceAutocompleteSelection(items);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        resourceAutocompleteSelectedIndex = Math.max(resourceAutocompleteSelectedIndex - 1, -1);
        updateResourceAutocompleteSelection(items);
    } else if (event.key === 'Enter') {
        event.preventDefault();
        if (resourceAutocompleteSelectedIndex >= 0) {
            const selectedItem = items[resourceAutocompleteSelectedIndex];
            selectResource(selectedItem.textContent);
        }
    } else if (event.key === 'Escape') {
        dropdown.style.display = 'none';
        resourceAutocompleteSelectedIndex = -1;
    }
}

function updateResourceAutocompleteSelection(items) {
    items.forEach((item, index) => {
        if (index === resourceAutocompleteSelectedIndex) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('selected');
        }
    });
}

function selectResource(name) {
    const input = document.getElementById('taskResources');
    const value = input.value;

    // Replace the current word being typed with the selected name
    const lastCommaIndex = value.lastIndexOf(',');
    let newValue;
    if (lastCommaIndex >= 0) {
        newValue = value.substring(0, lastCommaIndex + 1) + ' ' + name;
    } else {
        newValue = name;
    }

    input.value = newValue;
    const dropdown = document.getElementById('resourceAutocomplete');
    dropdown.style.display = 'none';
    resourceAutocompleteSelectedIndex = -1;
    input.focus();
    saveTask();
}

// Dependency autocomplete functionality
// Dependency autocomplete state is now in state.js

function handleDependencyInput(input) {
    currentDependencyInput = input;
    const dropdownId = input.getAttribute('data-dropdown');
    const dropdown = document.getElementById(dropdownId);
    const value = input.value.trim();

    if (value.length === 0) {
        dropdown.style.display = 'none';
        dependencyAutocompleteSelectedIndex = -1;
        saveTask();
        return;
    }

    // Get all task names
    const allTasks = getAllTaskNames();
    const matches = allTasks.filter(task =>
        task.toLowerCase().includes(value.toLowerCase())
    );

    if (matches.length === 0) {
        dropdown.style.display = 'none';
        dependencyAutocompleteSelectedIndex = -1;
        saveTask();
        return;
    }

    // Build dropdown
    dropdown.innerHTML = '';
    matches.forEach(task => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.textContent = task;
        item.onclick = () => selectDependency(task, input, dropdownId);
        dropdown.appendChild(item);
    });

    dropdown.style.display = 'block';
    dependencyAutocompleteSelectedIndex = -1;
    saveTask();
}

function handleDependencyKeydown(event, input) {
    const dropdownId = input.getAttribute('data-dropdown');
    const dropdown = document.getElementById(dropdownId);
    if (dropdown.style.display !== 'block') return;

    const items = dropdown.querySelectorAll('.autocomplete-item');
    if (items.length === 0) return;

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        dependencyAutocompleteSelectedIndex = Math.min(dependencyAutocompleteSelectedIndex + 1, items.length - 1);
        updateDependencyAutocompleteSelection(items);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        dependencyAutocompleteSelectedIndex = Math.max(dependencyAutocompleteSelectedIndex - 1, -1);
        updateDependencyAutocompleteSelection(items);
    } else if (event.key === 'Enter') {
        event.preventDefault();
        if (dependencyAutocompleteSelectedIndex >= 0) {
            const selectedItem = items[dependencyAutocompleteSelectedIndex];
            selectDependency(selectedItem.textContent, input, dropdownId);
        }
    } else if (event.key === 'Escape') {
        dropdown.style.display = 'none';
        dependencyAutocompleteSelectedIndex = -1;
    }
}

function updateDependencyAutocompleteSelection(items) {
    items.forEach((item, index) => {
        if (index === dependencyAutocompleteSelectedIndex) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('selected');
        }
    });
}

function selectDependency(taskName, input, dropdownId) {
    input.value = taskName;
    const dropdown = document.getElementById(dropdownId);
    dropdown.style.display = 'none';
    dependencyAutocompleteSelectedIndex = -1;
    input.focus();
    saveTask();
}

// Label autocomplete functionality
// Label autocomplete state is now in state.js

function getAllLabelNames() {
    const editor = document.getElementById('planEditor');
    if (!editor) return [];

    const lines = editor.value.split('\n');
    const labelSet = new Set();

    for (let i = 0; i < lines.length; i++) {
        const task = parseTaskLine(lines[i], i + 1);
        if (task.labels) {
            // Split labels by comma and collect unique ones
            const labels = task.labels.split(',').map(l => l.trim()).filter(l => l);
            labels.forEach(l => labelSet.add(l));
        }
    }

    return Array.from(labelSet).sort();
}

function handleLabelInput() {
    const input = document.getElementById('taskLabels');
    const dropdown = document.getElementById('labelAutocomplete');
    const value = input.value;

    // Get the current word being typed (after the last comma)
    const lastCommaIndex = value.lastIndexOf(',');
    const currentWord = value.substring(lastCommaIndex + 1).trim();

    if (currentWord.length === 0) {
        dropdown.style.display = 'none';
        labelAutocompleteSelectedIndex = -1;
        saveTask();
        return;
    }

    // Get all label names and filter by current word
    const allLabels = getAllLabelNames();
    const matches = allLabels.filter(name =>
        name.toLowerCase().includes(currentWord.toLowerCase())
    );

    if (matches.length === 0) {
        dropdown.style.display = 'none';
        labelAutocompleteSelectedIndex = -1;
        saveTask();
        return;
    }

    // Build dropdown HTML
    dropdown.innerHTML = '';
    matches.forEach((name, index) => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.textContent = name;
        item.onclick = function() {
            selectLabel(name);
        };
        dropdown.appendChild(item);
    });

    dropdown.style.display = 'block';
    labelAutocompleteSelectedIndex = -1;
    saveTask();
}

function handleLabelKeydown(event) {
    const dropdown = document.getElementById('labelAutocomplete');
    if (dropdown.style.display !== 'block') return;

    const items = dropdown.querySelectorAll('.autocomplete-item');
    if (items.length === 0) return;

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        labelAutocompleteSelectedIndex = Math.min(labelAutocompleteSelectedIndex + 1, items.length - 1);
        updateLabelAutocompleteSelection(items);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        labelAutocompleteSelectedIndex = Math.max(labelAutocompleteSelectedIndex - 1, -1);
        updateLabelAutocompleteSelection(items);
    } else if (event.key === 'Enter') {
        event.preventDefault();
        if (labelAutocompleteSelectedIndex >= 0) {
            const selectedItem = items[labelAutocompleteSelectedIndex];
            selectLabel(selectedItem.textContent);
        }
    } else if (event.key === 'Escape') {
        dropdown.style.display = 'none';
        labelAutocompleteSelectedIndex = -1;
    }
}

function updateLabelAutocompleteSelection(items) {
    items.forEach((item, index) => {
        if (index === labelAutocompleteSelectedIndex) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('selected');
        }
    });
}

function selectLabel(name) {
    const input = document.getElementById('taskLabels');
    const value = input.value;

    // Replace the current word being typed with the selected name
    const lastCommaIndex = value.lastIndexOf(',');
    let newValue;
    if (lastCommaIndex >= 0) {
        newValue = value.substring(0, lastCommaIndex + 1) + ' ' + name;
    } else {
        newValue = name;
    }

    input.value = newValue;
    const dropdown = document.getElementById('labelAutocomplete');
    dropdown.style.display = 'none';
    labelAutocompleteSelectedIndex = -1;
    input.focus();
    saveTask();
}

// Project label autocomplete functionality
// Project label autocomplete state is now in state.js

function handleProjectLabelInput() {
    const input = document.getElementById('projectLabels');
    const dropdown = document.getElementById('projectLabelAutocomplete');
    const value = input.value;

    // Get the current word being typed (after the last comma)
    const lastCommaIndex = value.lastIndexOf(',');
    const currentWord = value.substring(lastCommaIndex + 1).trim();

    if (currentWord.length === 0) {
        dropdown.style.display = 'none';
        projectLabelAutocompleteSelectedIndex = -1;
        return;
    }

    // Get all label names and filter by current word
    const allLabels = getAllLabelNames();
    const matches = allLabels.filter(name =>
        name.toLowerCase().includes(currentWord.toLowerCase())
    );

    if (matches.length === 0) {
        dropdown.style.display = 'none';
        projectLabelAutocompleteSelectedIndex = -1;
        return;
    }

    // Build dropdown HTML
    dropdown.innerHTML = '';
    matches.forEach((name, index) => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.textContent = name;
        item.onclick = function() {
            selectProjectLabel(name);
        };
        dropdown.appendChild(item);
    });

    dropdown.style.display = 'block';
    projectLabelAutocompleteSelectedIndex = -1;
}

function handleProjectLabelKeydown(event) {
    const dropdown = document.getElementById('projectLabelAutocomplete');
    if (dropdown.style.display !== 'block') return;

    const items = dropdown.querySelectorAll('.autocomplete-item');
    if (items.length === 0) return;

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        projectLabelAutocompleteSelectedIndex = Math.min(projectLabelAutocompleteSelectedIndex + 1, items.length - 1);
        updateProjectLabelAutocompleteSelection(items);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        projectLabelAutocompleteSelectedIndex = Math.max(projectLabelAutocompleteSelectedIndex - 1, -1);
        updateProjectLabelAutocompleteSelection(items);
    } else if (event.key === 'Enter') {
        event.preventDefault();
        if (projectLabelAutocompleteSelectedIndex >= 0) {
            const selectedItem = items[projectLabelAutocompleteSelectedIndex];
            selectProjectLabel(selectedItem.textContent);
        }
    } else if (event.key === 'Escape') {
        dropdown.style.display = 'none';
        projectLabelAutocompleteSelectedIndex = -1;
    }
}

function updateProjectLabelAutocompleteSelection(items) {
    items.forEach((item, index) => {
        if (index === projectLabelAutocompleteSelectedIndex) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('selected');
        }
    });
}

function selectProjectLabel(name) {
    const input = document.getElementById('projectLabels');
    const value = input.value;

    // Replace the current word being typed with the selected name
    const lastCommaIndex = value.lastIndexOf(',');
    let newValue;
    if (lastCommaIndex >= 0) {
        newValue = value.substring(0, lastCommaIndex + 1) + ' ' + name;
    } else {
        newValue = name;
    }

    input.value = newValue;
    const dropdown = document.getElementById('projectLabelAutocomplete');
    dropdown.style.display = 'none';
    projectLabelAutocompleteSelectedIndex = -1;
    input.focus();
}

// Initialize event listeners after DOM is loaded
// Toggle export dropdown menu

document.addEventListener('DOMContentLoaded', function() {
    // Initialize resizer
    initResizer();

    // Initialize gantt splitter
    initGanttSplitter();

    // Initialize editor splitter for drag-to-resize
    initEditorSplitter();

    // Re-render timelines on window resize so they fill the available width
    let resizeTimer;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function() {
            if (timelineTasks && timelineTasks.length > 0) {
                updateReportTimeline(timelineTasks, timelineProjectName);
                updateAllEmbeddedTimelines();
            }
        }, 200);
    });

    // Close detail pane when clicking the overlay backdrop
    const detailOverlay = document.getElementById('detailPaneOverlay');
    if (detailOverlay) {
        detailOverlay.addEventListener('click', function() {
            if (isDetailPaneOpen()) {
                // Determine which section is active and call its close function
                const pane = document.getElementById('detailPane');
                const activeSection = pane.querySelector('.detail-pane-section.active');
                if (activeSection) {
                    switch (activeSection.id) {
                        case 'taskFormSection': closeTaskForm(); break;
                        case 'raidFormSection': closeRaidForm(); break;
                        case 'benefitsFormSection': closeBenefitForm(); break;
                        case 'highlightFormSection': closeHighlightForm(); break;
                        case 'benefitsFormSection': closeBenefitForm(); break;
                        case 'projectDetailsSection': closeProjectDetailsForm(); break;
                        case 'resourceFormSection': saveResource(); break;
                        case 'taskInspectorSection': closeTaskInspector(); break;
                        default: closeDetailPane();
                    }
                } else {
                    closeDetailPane();
                }
            }
        });
    }

    // Close detail pane when pressing Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            // Check if AI chat panel is open - close it first
            if (typeof aiChatOpen !== 'undefined' && aiChatOpen) {
                closeAIChat();
                return;
            }

            // First check if keyboard shortcuts modal is open - close it
            const kbOverlay = document.getElementById('keyboardShortcutsOverlay');
            if (kbOverlay && kbOverlay.classList.contains('active')) {
                closeKeyboardShortcuts();
                return;
            }

            // Check if any autocomplete dropdown is open - close it instead
            const depDropdown = document.getElementById('dependencyAutocomplete');
            if (depDropdown && depDropdown.style.display === 'block') {
                depDropdown.style.display = 'none';
                autocompleteSelectedIndex = -1;
                return;
            }

            const resDropdown = document.getElementById('resourceAutocomplete');
            if (resDropdown && resDropdown.style.display === 'block') {
                resDropdown.style.display = 'none';
                resourceAutocompleteSelectedIndex = -1;
                return;
            }

            // If detail pane is open, close the active section
            if (isDetailPaneOpen()) {
                const pane = document.getElementById('detailPane');
                const activeSection = pane.querySelector('.detail-pane-section.active');
                if (activeSection) {
                    switch (activeSection.id) {
                        case 'taskFormSection': closeTaskForm(); break;
                        case 'raidFormSection': closeRaidForm(); break;
                        case 'benefitsFormSection': closeBenefitForm(); break;
                        case 'highlightFormSection': closeHighlightForm(); break;
                        case 'benefitsFormSection': closeBenefitForm(); break;
                        case 'projectDetailsSection': closeProjectDetailsForm(); break;
                        case 'resourceFormSection': saveResource(); break;
                        case 'taskInspectorSection': closeTaskInspector(); break;
                        default: closeDetailPane();
                    }
                } else {
                    closeDetailPane();
                }
            }
        }
    });

    // Ctrl+S - Save plan as markdown file (works from anywhere, including editor)
    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 's' && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            downloadMarkdown();
        }
    });

    // Ctrl+Shift+A - Toggle AI Chat panel
    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'A' || e.key === 'a') && !e.altKey) {
            e.preventDefault();
            if (typeof toggleAIChat === 'function') {
                toggleAIChat();
            }
        }
    });

    // Global keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        // Skip shortcuts when typing in text inputs, textareas, or contenteditable elements
        if (isTypingInInput(e.target)) {
            return;
        }

        // ? key (without modifiers) - show keyboard shortcuts help
        if (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            showKeyboardShortcuts();
            return;
        }

        // Alt-based shortcuts
        if (e.altKey && !e.ctrlKey && !e.metaKey) {
            // Alt+Shift combinations
            if (e.shiftKey) {
                switch (e.key) {
                    case 'R':  // Alt+Shift+R - New Resource
                        e.preventDefault();
                        openResourceForm();
                        return;
                    case 'P':  // Alt+Shift+P - Export Portfolio to PowerPoint
                        e.preventDefault();
                        if (typeof exportPortfolioReport === 'function') {
                            exportPortfolioReport();
                        }
                        return;
                }
            }

            // Alt (no Shift) combinations
            if (!e.shiftKey) {
                switch (e.key) {
                    case 'd':  // Alt+D - Go to Project Dashboard
                        e.preventDefault();
                        switchToView('project-report');
                        return;
                    case 'p':  // Alt+P - Go to Portfolio
                        e.preventDefault();
                        switchTab('portfolio');
                        return;
                    case 'n':  // Alt+N - New Project
                        e.preventDefault();
                        if (typeof showCreateProjectDialog === 'function') {
                            showCreateProjectDialog();
                        }
                        return;
                    case 't':  // Alt+T - New Task
                        e.preventDefault();
                        addNewTaskViaShortcut();
                        return;
                    case 'r':  // Alt+R - New Risk
                        e.preventDefault();
                        openRaidFormWithType('risk');
                        return;
                    case 'i':  // Alt+I - New Issue
                        e.preventDefault();
                        openRaidFormWithType('issue');
                        return;
                    case 'e':  // Alt+E - Export to Excel
                        e.preventDefault();
                        exportFile('excel', 'editor');
                        return;
                    case 'b':  // Alt+B - Go to Benefits Map
                        e.preventDefault();
                        switchToView('benefits');
                        return;
                }
            }
        }
    });

    // Close autocomplete dropdowns when clicking outside
    document.addEventListener('click', function(e) {
        // Handle dependency autocomplete (old single input - may still exist in code)
        const depDropdown = document.getElementById('dependencyAutocomplete');
        const depInput = document.getElementById('taskDependencies');
        if (depDropdown && depInput && !depInput.contains(e.target) && !depDropdown.contains(e.target)) {
            depDropdown.style.display = 'none';
            autocompleteSelectedIndex = -1;
        }

        // Handle dependency table autocomplete dropdowns
        const depInputs = document.querySelectorAll('.dependency-task-name');
        depInputs.forEach(input => {
            const dropdownId = input.getAttribute('data-dropdown');
            if (dropdownId) {
                const dropdown = document.getElementById(dropdownId);
                if (dropdown && !input.contains(e.target) && !dropdown.contains(e.target)) {
                    dropdown.style.display = 'none';
                    dependencyAutocompleteSelectedIndex = -1;
                }
            }
        });

        // Handle resource autocomplete
        const resDropdown = document.getElementById('resourceAutocomplete');
        const resInput = document.getElementById('taskResources');
        if (resDropdown && resInput && !resInput.contains(e.target) && !resDropdown.contains(e.target)) {
            resDropdown.style.display = 'none';
            resourceAutocompleteSelectedIndex = -1;
        }
    });

    // Function to attach double-click handler to any editor
    function attachDoubleClickHandler(editor) {
        if (!editor) return;

        editor.addEventListener('dblclick', function(e) {
            const textarea = e.target;
            const cursorPosition = textarea.selectionStart;
            const textBeforeCursor = textarea.value.substring(0, cursorPosition);
            const lineNumber = textBeforeCursor.split('\n').length;

            // Get the line content
            const lines = textarea.value.split('\n');
            const line = lines[lineNumber - 1];

            // Check if we're in the front matter
            let inFrontMatter = false;

            if (lines[0] && lines[0].trim() === '---') {
                // Front matter starts on line 1
                let endLineNumber = -1;
                for (let i = 1; i < lines.length; i++) {
                    if (lines[i].trim() === '---') {
                        // Found end of front matter
                        endLineNumber = i + 1; // Line numbers are 1-based
                        break;
                    }
                }
                // Check if current line is within front matter (including the --- delimiters)
                if (endLineNumber > 0 && lineNumber >= 1 && lineNumber <= endLineNumber) {
                    inFrontMatter = true;
                }
            }

            if (inFrontMatter) {
                // Check if this is a resource line: - @shortname: ...
                const resourceMatch = line.trim().match(/^-\s*@(\w+):\s*(.+)/);
                if (resourceMatch) {
                    // Open resource form for this resource
                    const shortname = resourceMatch[1];
                    openResourceForm(shortname);
                } else {
                    // Open project details form for other front matter
                    openProjectDetailsForm();
                }
            } else if (line && line.trim() && !line.includes('===') && !line.includes('---')) {
                // Only open form for task lines (not empty lines, phase headers, or summary lines)
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    openTaskForm(lineNumber);
                }
            }
        });
    }

    // Add double-click handler to both editors for opening task form
    const mainEditor = document.getElementById('planEditor');
    const kanbanEditor = document.getElementById('kanbanPlanEditor');

    attachDoubleClickHandler(mainEditor);
    attachDoubleClickHandler(kanbanEditor);

    // Mobile support - only for main editor for now
    if (mainEditor) {

        // Double-tap support for mobile
        let lastTapTime = 0;
        let lastTapY = 0;
        mainEditor.addEventListener('touchend', function(e) {
            const currentTime = new Date().getTime();
            const tapInterval = currentTime - lastTapTime;
            const touch = e.changedTouches[0];
            const tapY = touch.clientY;

            // Check if this is a double-tap (within 300ms and close to same location)
            if (tapInterval < 300 && tapInterval > 0 && Math.abs(tapY - lastTapY) < 20) {
                // Find which line was tapped
                const textarea = e.target;
                const rect = textarea.getBoundingClientRect();
                const y = touch.clientY - rect.top;
                const lineHeight = parseInt(window.getComputedStyle(textarea).lineHeight);
                const scrollTop = textarea.scrollTop;
                const lineNumber = Math.floor((y + scrollTop) / lineHeight) + 1;

                // Get the line content
                const lines = textarea.value.split('\n');
                if (lineNumber > 0 && lineNumber <= lines.length) {
                    const line = lines[lineNumber - 1];

                    // Only open form for task lines
                    if (line && line.trim() && !line.includes('===') && !line.includes('---')) {
                        const trimmed = line.trim();
                        if (trimmed && !trimmed.startsWith('#')) {
                            openTaskForm(lineNumber);
                            e.preventDefault();
                        }
                    }
                }

                lastTapTime = 0;
            } else {
                lastTapTime = currentTime;
                lastTapY = tapY;
            }
        });
    }
});

/**
 * Project Details Form Functions
 */

function openProjectDetailsForm() {
    // Parse and populate form from front matter
    populateProjectDetailsFromFrontMatter();

    openDetailPane('projectDetailsSection');

    // Focus on the first input
    setTimeout(() => {
        const firstInput = document.getElementById('projectManager');
        if (firstInput) firstInput.focus();
    }, 100);
}

function closeProjectDetailsForm() {
    closeDetailPane();
}

function toggleProjectDetails() {
    const pane = document.getElementById('detailPane');
    const section = document.getElementById('projectDetailsSection');
    if (pane && pane.classList.contains('open') && section && section.classList.contains('active')) {
        closeProjectDetailsForm();
    } else {
        openProjectDetailsForm();
    }
}

// ESC and click-outside for project details are handled by the unified detail pane handlers

// Resource Form Functions
function openResourceForm(existingShortname = null) {
    // Track where we came from so we can return there
    const pane = document.getElementById('detailPane');
    const activeSection = pane.querySelector('.detail-pane-section.active');
    if (activeSection && activeSection.id === 'projectDetailsSection') {
        resourceFormReturnSection = 'projectDetailsSection';
    } else {
        resourceFormReturnSection = null;
    }

    // Clear form
    document.getElementById('resourceShortname').value = '';
    document.getElementById('resourceFullName').value = '';
    document.getElementById('resourceRole').value = '';
    document.getElementById('resourceEmail').value = '';
    document.getElementById('resourceAllocation').value = '';
    initNwdTable('resourceNonWorkingDaysTableBody', []);

    // If editing existing resource, populate form
    if (existingShortname) {
        populateResourceForm(existingShortname);
    }

    openDetailPane('resourceFormSection');

    // Populate assigned tasks
    populateResourceAssignedTasks(existingShortname);

    // Focus on first field
    setTimeout(() => {
        document.getElementById('resourceShortname').focus();
    }, 100);
}

function populateResourceAssignedTasks(shortname) {
    const el = document.getElementById('resourceAssignedTasks');
    if (!el) return;

    if (!shortname || !lastRenderedTasks || lastRenderedTasks.length === 0) {
        el.innerHTML = '<span style="color: var(--text-secondary); font-style: italic;">No tasks assigned</span>';
        return;
    }

    const sn = shortname.toLowerCase();
    const assigned = lastRenderedTasks.filter(t => {
        if (t.is_summary) return false;
        const res = (t.resources || '').toLowerCase();
        return res.split(',').some(r => {
            const trimmed = r.trim().toLowerCase();
            return trimmed === sn || trimmed === globalResourceMap[sn]?.toLowerCase();
        });
    });

    if (assigned.length === 0) {
        el.innerHTML = '<span style="color: var(--text-secondary); font-style: italic;">No tasks assigned</span>';
        return;
    }

    el.innerHTML = assigned.map(t => {
        const name = (t.name || '').replace(/</g, '&lt;');
        const pct = t.percent || 0;
        const rag = t.rag || '';
        const ragClass = rag ? 'rag-' + (typeof ragStatusToColour === 'function' ? ragStatusToColour(rag) : '') : '';
        return `<div class="product-comp-item" style="cursor: pointer;" onclick="openTaskFormByName('${name.replace(/'/g, "\\'")}')">
            <span class="product-comp-name">${name}</span>
            <span class="product-comp-pct">${pct}%</span>
        </div>`;
    }).join('');
}

function closeResourceForm() {
    if (resourceFormReturnSection) {
        // Return to the section that opened the resource form
        openDetailPane(resourceFormReturnSection);
        resourceFormReturnSection = null;
    } else {
        closeDetailPane();
    }
}

function populateResourceForm(shortname) {
    console.log('populateResourceForm called with shortname:', shortname);
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const content = editor.value;
    const frontMatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!frontMatterMatch) {
        console.log('No front matter found');
        return;
    }

    const frontMatter = frontMatterMatch[1];
    const lines = frontMatter.split('\n');

    // Normalize shortname to lowercase for case-insensitive comparison
    const shortnameLC = shortname.toLowerCase();
    console.log('Looking for shortname (lowercase):', shortnameLC);

    let inResources = false;
    for (let line of lines) {
        if (line.trim() === 'Resources:') {
            inResources = true;
            console.log('Found Resources section');
            continue;
        }

        if (inResources && line.trim().startsWith('-')) {
            // Parse resource line: - @shortname: Full Name, Role, email, allocation%, non-working [...]
            const match = line.match(/^-\s*@([^:]+):\s*(.+)$/);
            console.log('Checking resource line:', line, 'match:', match);
            if (match && match[1].trim().toLowerCase() === shortnameLC) {
                console.log('Found matching resource!', match[1].trim(), '(case-insensitive match with)', shortname);

                // Extract non-working days suffix before splitting by comma
                let fullInfo = match[2];
                let nwdEntries = [];
                const nwdMatch = fullInfo.match(/,?\s*non-working\s*\[([^\]]*)\]\s*$/);
                if (nwdMatch) {
                    // Parse named entries from the bracket content
                    const nwdContent = nwdMatch[1];
                    for (const part of nwdContent.split(',')) {
                        const trimmed = part.trim();
                        if (!trimmed) continue;
                        // Named entry: "Name: date" or "Name: date:date"
                        const namedMatch = trimmed.match(/^(.+?):\s*(\d{4}-\d{2}-\d{2})(?::(\d{4}-\d{2}-\d{2}))?\s*$/);
                        if (namedMatch) {
                            // Check if first group is a date (legacy range without name)
                            if (/^\d{4}-\d{2}-\d{2}$/.test(namedMatch[1].trim())) {
                                nwdEntries.push({ name: '', start: namedMatch[1].trim(), finish: namedMatch[2] });
                            } else {
                                nwdEntries.push({
                                    name: namedMatch[1].trim(),
                                    start: namedMatch[2],
                                    finish: namedMatch[3] || '',
                                });
                            }
                        } else {
                            // Single date without name
                            const dateMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})$/);
                            if (dateMatch) {
                                nwdEntries.push({ name: '', start: dateMatch[1], finish: '' });
                            }
                        }
                    }
                    // Remove the non-working suffix from fullInfo
                    fullInfo = fullInfo.slice(0, nwdMatch.index).trim().replace(/,\s*$/, '');
                }

                const parts = fullInfo.split(',').map(p => p.trim());
                document.getElementById('resourceShortname').value = shortname;
                document.getElementById('resourceFullName').value = parts[0] || '';
                document.getElementById('resourceRole').value = parts[1] || '';
                document.getElementById('resourceEmail').value = parts[2] || '';

                // Parse allocation percentage
                if (parts[3] && parts[3].includes('%')) {
                    document.getElementById('resourceAllocation').value = parts[3].replace('%', '').trim();
                }

                // Render resource-level non-working days in the exceptions table
                initNwdTable('resourceNonWorkingDaysTableBody', nwdEntries);

                console.log('Successfully populated form fields');
                return; // Found and populated, exit early
            }
        } else if (inResources && line.trim() && !line.trim().startsWith('-')) {
            // Non-empty line that's not a resource entry means we've left the Resources section
            console.log('Exiting Resources section at line:', line);
            inResources = false;
        }
    }

    console.log('ERROR: No matching resource found for shortname:', shortname);
}

// Auto-save resource with debounce
// Resource debounce state is now in state.js

function autoSaveResource() {
    // Clear existing timer
    if (resourceDebounceTimer) {
        clearTimeout(resourceDebounceTimer);
    }

    // Set new timer for 1 second debounce
    resourceDebounceTimer = setTimeout(() => {
        saveResourceInternal(false); // Don't close modal on auto-save
    }, 1000);
}

function saveResource() {
    // Clear any pending auto-save
    if (resourceDebounceTimer) {
        clearTimeout(resourceDebounceTimer);
        resourceDebounceTimer = null;
    }

    saveResourceInternal(true); // Close modal when explicitly saving
}

function saveResourceInternal(closeModal = true) {
    const shortname = document.getElementById('resourceShortname').value.trim();
    const fullName = document.getElementById('resourceFullName').value.trim();
    const role = document.getElementById('resourceRole').value.trim();
    const email = document.getElementById('resourceEmail').value.trim();
    const allocation = document.getElementById('resourceAllocation').value.trim();

    if (!shortname || !fullName) {
        // Don't show alert on auto-save, only on explicit save
        if (closeModal) {
            alert('Shortname and Full Name are required');
        }
        return;
    }

    // Build resource line (with inline non-working days if any)
    let resourceParts = [fullName];
    if (role) resourceParts.push(role);
    if (email) resourceParts.push(email);
    if (allocation) resourceParts.push(`${allocation}%`);

    // Append non-working days as inline suffix (named entries with ranges)
    const resourceNwdSuffix = buildResourceNwdSuffix('resourceNonWorkingDaysTableBody');
    if (resourceNwdSuffix) {
        resourceParts.push(resourceNwdSuffix);
    }

    const resourceLine = `- @${shortname}: ${resourceParts.join(', ')}`;

    // Update editor
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const lines = editor.value.split('\n');
    let inFrontMatter = false;
    let frontMatterEnd = -1;
    let resourcesLineIndex = -1;
    let existingResourceIndex = -1;

    // Find front matter and Resources section
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.trim() === '---') {
            if (!inFrontMatter) {
                inFrontMatter = true;
            } else {
                frontMatterEnd = i;
                break;
            }
            continue;
        }

        if (inFrontMatter && line.trim() === 'Resources:') {
            resourcesLineIndex = i;
        }

        // Check if editing existing resource
        if (inFrontMatter && line.includes(`@${shortname}:`)) {
            existingResourceIndex = i;
        }
    }

    // If editing existing, replace line
    if (existingResourceIndex >= 0) {
        lines[existingResourceIndex] = resourceLine;
    } else {
        // Adding new resource
        if (!inFrontMatter || frontMatterEnd === -1) {
            // No front matter, create it
            lines.unshift('---');
            lines.splice(1, 0, 'Resources:');
            lines.splice(2, 0, resourceLine);
            lines.splice(3, 0, '---');
        } else if (resourcesLineIndex === -1) {
            // Front matter exists but no Resources section
            lines.splice(frontMatterEnd, 0, 'Resources:');
            lines.splice(frontMatterEnd + 1, 0, resourceLine);
        } else {
            // Resources section exists, add new resource
            let insertIndex = resourcesLineIndex + 1;
            while (insertIndex < frontMatterEnd && lines[insertIndex].trim().startsWith('-')) {
                insertIndex++;
            }
            lines.splice(insertIndex, 0, resourceLine);
        }
    }

    // Update editor
    editor.value = lines.join('\n');
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    // Close form only if explicitly requested
    if (closeModal) {
        closeResourceForm();
    }

    // Refresh Kanban if active
    if (window.kanbanBoard) {
        setTimeout(() => {
            window.kanbanBoard.parse();
            window.kanbanBoard.render();
        }, 100);
    }
}

// ESC for resource form is handled by the unified detail pane handler

function populateProjectDetailsFromFrontMatter() {
    const editor = document.getElementById('planEditor');
    const content = editor.value;

    // Parse front matter
    const frontMatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!frontMatterMatch) {
        // No front matter, initialize empty form
        clearProjectDetailsForm();
        return;
    }

    const frontMatter = frontMatterMatch[1];
    const lines = frontMatter.split('\n');

    // Clear existing form
    document.getElementById('projectTitle').value = '';
    document.getElementById('projectManager').value = '';
    document.getElementById('projectStartDate').value = '';
    document.getElementById('projectStatus').value = 'Open';
    document.getElementById('projectSponsor').value = '';
    document.getElementById('projectDescription').value = '';
    document.getElementById('projectBudget').value = '';
    document.getElementById('projectLabels').value = '';
    document.getElementById('resourcesList').innerHTML = '';
    document.getElementById('stakeholdersList').innerHTML = '';
    initNwdTable('nonWorkingDaysTableBody', []);

    let inResources = false;
    let inStakeholders = false;
    let inNonWorkingDays = false;
    const nwdEntries = [];

    for (let line of lines) {
        line = line.trim();

        // Check for section headers
        if (line.toLowerCase() === 'resources:') {
            inResources = true;
            inStakeholders = false;
            inNonWorkingDays = false;
            continue;
        } else if (line.toLowerCase() === 'key stakeholders:' || line.toLowerCase() === 'stakeholders:') {
            inStakeholders = true;
            inResources = false;
            inNonWorkingDays = false;
            continue;
        } else if (line.toLowerCase() === 'non-working-days:' || line.toLowerCase() === 'holidays:') {
            inNonWorkingDays = true;
            inResources = false;
            inStakeholders = false;
            continue;
        } else if (line.match(/^[a-z\s-]+:/i) && !line.startsWith('-')) {
            // New section header, stop parsing current section
            inResources = false;
            inStakeholders = false;
            inNonWorkingDays = false;
        }

        // Parse non-working days list items (new format)
        if (inNonWorkingDays && line.startsWith('- ')) {
            const entry = line.substring(2).trim();
            // Named entry: "Name: date" or "Name: date:date"
            const namedMatch = entry.match(/^(.+?):\s*(\d{4}-\d{2}-\d{2})(?::(\d{4}-\d{2}-\d{2}))?\s*$/);
            if (namedMatch) {
                nwdEntries.push({
                    name: namedMatch[1].trim(),
                    start: namedMatch[2],
                    finish: namedMatch[3] || '',
                });
            } else {
                // Bare date
                const dateMatch = entry.match(/^(\d{4}-\d{2}-\d{2})\s*$/);
                if (dateMatch) {
                    nwdEntries.push({ name: '', start: dateMatch[1], finish: '' });
                }
            }
            continue;
        }

        // Parse resources and stakeholders
        if (inResources && line.startsWith('- @')) {
            const resourceData = line.substring(2).trim(); // Remove "- "
            addResourceRow(resourceData);
        } else if (inStakeholders && line.startsWith('- @')) {
            const stakeholderData = line.substring(2).trim(); // Remove "- "
            addStakeholderRow(stakeholderData);
        }

        // Parse other fields
        const match = line.match(/^([^:]+):\s*(.*)$/);
        if (match && !inResources && !inStakeholders && !inNonWorkingDays) {
            const key = match[1].trim().toLowerCase();
            const value = match[2].trim();

            switch (key) {
                case 'title':
                    document.getElementById('projectTitle').value = value;
                    break;
                case 'project manager':
                case 'project owner':
                case 'owner':
                    document.getElementById('projectManager').value = value;
                    break;
                case 'start date':
                case 'project start date':
                    document.getElementById('projectStartDate').value = value;
                    break;
                case 'status':
                    document.getElementById('projectStatus').value = value;
                    break;
                case 'sponsor':
                    document.getElementById('projectSponsor').value = value;
                    break;
                case 'description':
                    document.getElementById('projectDescription').value = value;
                    break;
                case 'budget':
                    document.getElementById('projectBudget').value = value;
                    break;
                case 'labels':
                    // Parse labels: [red, green, blue] format
                    const labelsMatch = value.match(/\[([^\]]+)\]/);
                    if (labelsMatch) {
                        document.getElementById('projectLabels').value = labelsMatch[1].trim();
                    } else {
                        document.getElementById('projectLabels').value = value;
                    }
                    break;
                case 'non-working-days':
                case 'holidays':
                    // Legacy flat format: non-working-days: 2026-12-25, 2026-12-26
                    if (value) {
                        const dateMatches = value.match(/\d{4}-\d{2}-\d{2}/g);
                        if (dateMatches) {
                            dateMatches.forEach(d => nwdEntries.push({ name: '', start: d, finish: '' }));
                        }
                    }
                    break;
            }
        }
    }

    // Populate non-working days table
    if (nwdEntries.length > 0) {
        initNwdTable('nonWorkingDaysTableBody', nwdEntries);
    }
}

function clearProjectDetailsForm() {
    document.getElementById('projectTitle').value = '';
    document.getElementById('projectManager').value = '';
    document.getElementById('projectStartDate').value = '';
    document.getElementById('projectStatus').value = 'Open';
    document.getElementById('projectSponsor').value = '';
    document.getElementById('projectDescription').value = '';
    document.getElementById('projectBudget').value = '';
    document.getElementById('projectLabels').value = '';
    document.getElementById('resourcesList').innerHTML = '';
    document.getElementById('stakeholdersList').innerHTML = '';
    initNwdTable('nonWorkingDaysTableBody', []);
}

// --- Non-Working Days Exceptions Table Functions ---

/**
 * Add a row to a non-working days exceptions table.
 * @param {string} tbodyId - The ID of the tbody element.
 * @param {object} entry - Optional entry with name, start, finish fields.
 * @param {boolean} isBlank - Whether this is the blank entry row at the bottom.
 */
function addNwdTableRow(tbodyId, entry = null, isBlank = false) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    const row = document.createElement('tr');
    if (isBlank) row.classList.add('nwd-blank-row');

    const nameCell = document.createElement('td');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = isBlank ? 'Type to add...' : '';
    nameInput.value = entry ? (entry.name || '') : '';
    nameInput.setAttribute('aria-label', 'Non-working day name');
    nameInput.addEventListener('input', function() {
        handleNwdRowChange(tbodyId, row);
    });
    nameCell.appendChild(nameInput);
    row.appendChild(nameCell);

    const startCell = document.createElement('td');
    const startInput = document.createElement('input');
    startInput.type = 'date';
    startInput.value = entry ? (entry.start || '') : '';
    startInput.setAttribute('aria-label', 'Start date');
    startInput.addEventListener('change', function() {
        handleNwdRowChange(tbodyId, row);
    });
    startCell.appendChild(startInput);
    row.appendChild(startCell);

    const finishCell = document.createElement('td');
    const finishInput = document.createElement('input');
    finishInput.type = 'date';
    finishInput.value = entry ? (entry.finish || '') : '';
    finishInput.setAttribute('aria-label', 'Finish date');
    finishInput.addEventListener('change', function() {
        handleNwdRowChange(tbodyId, row);
    });
    finishCell.appendChild(finishInput);
    row.appendChild(finishCell);

    const actionsCell = document.createElement('td');
    actionsCell.classList.add('nwd-actions-col');
    if (!isBlank) {
        const deleteBtn = document.createElement('np-button');
        deleteBtn.setAttribute('icon-only', '');
        deleteBtn.setAttribute('variant', 'danger');
        deleteBtn.setAttribute('size', 'small');
        deleteBtn.className = 'nwd-delete-btn';
        deleteBtn.innerHTML = '<span slot="icon">&times;</span>';
        deleteBtn.setAttribute('label', 'Remove this non-working day');
        deleteBtn.addEventListener('click', function() {
            row.remove();
            triggerNwdAutoSave(tbodyId);
        });
        actionsCell.appendChild(deleteBtn);
    }
    row.appendChild(actionsCell);

    tbody.appendChild(row);
    return row;
}

/**
 * Handle changes to a non-working day row (convert blank row, remove empty rows).
 */
function handleNwdRowChange(tbodyId, row) {
    const inputs = row.querySelectorAll('input');
    const name = inputs[0].value.trim();
    const start = inputs[1].value.trim();
    const finish = inputs[2].value.trim();
    const hasContent = name || start || finish;

    if (row.classList.contains('nwd-blank-row') && hasContent) {
        // Convert blank row to data row: add delete button, remove blank class
        row.classList.remove('nwd-blank-row');
        inputs[0].placeholder = '';
        const actionsCell = row.querySelector('.nwd-actions-col');
        if (actionsCell && !actionsCell.querySelector('.nwd-delete-btn')) {
            const deleteBtn = document.createElement('np-button');
            deleteBtn.setAttribute('icon-only', '');
            deleteBtn.setAttribute('variant', 'danger');
            deleteBtn.setAttribute('size', 'small');
            deleteBtn.className = 'nwd-delete-btn';
            deleteBtn.innerHTML = '<span slot="icon">&times;</span>';
            deleteBtn.setAttribute('label', 'Remove this non-working day');
            deleteBtn.addEventListener('click', function() {
                row.remove();
                triggerNwdAutoSave(tbodyId);
            });
            actionsCell.appendChild(deleteBtn);
        }
        // Add a new blank row at the bottom
        addNwdTableRow(tbodyId, null, true);
    } else if (!row.classList.contains('nwd-blank-row') && !hasContent) {
        // All fields empty on a data row: auto-remove it
        row.remove();
    }

    triggerNwdAutoSave(tbodyId);
}

/**
 * Trigger auto-save based on which table was modified.
 */
function triggerNwdAutoSave(tbodyId) {
    if (tbodyId === 'nonWorkingDaysTableBody') {
        autoSaveProjectDetails();
    } else if (tbodyId === 'resourceNonWorkingDaysTableBody') {
        autoSaveResource();
    }
}

/**
 * Initialize a non-working days table with entries and a blank row.
 * @param {string} tbodyId - The tbody element ID.
 * @param {Array} entries - Array of {name, start, finish} objects.
 */
function initNwdTable(tbodyId, entries) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = '';
    if (entries && entries.length > 0) {
        entries.forEach(entry => addNwdTableRow(tbodyId, entry, false));
    }
    addNwdTableRow(tbodyId, null, true);
}

/**
 * Get all non-working day entries from a table as an array of {name, start, finish}.
 */
function getNwdEntriesFromTable(tbodyId) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return [];
    const entries = [];
    const rows = tbody.querySelectorAll('tr:not(.nwd-blank-row)');
    rows.forEach(row => {
        const inputs = row.querySelectorAll('input');
        const name = inputs[0] ? inputs[0].value.trim() : '';
        const start = inputs[1] ? inputs[1].value.trim() : '';
        const finish = inputs[2] ? inputs[2].value.trim() : '';
        if (start) {
            entries.push({ name, start, finish });
        }
    });
    // Sort by start date
    entries.sort((a, b) => a.start.localeCompare(b.start));
    return entries;
}

/**
 * Build front matter string for non-working days from the table entries.
 * Returns the YAML lines (including the key) or empty string.
 */
function buildNwdFrontMatter(tbodyId) {
    const entries = getNwdEntriesFromTable(tbodyId);
    if (entries.length === 0) return '';
    let lines = 'non-working-days:\n';
    entries.forEach(e => {
        const name = e.name || 'Untitled';
        const dateStr = e.finish ? `${e.start}:${e.finish}` : e.start;
        lines += `  - ${name}: ${dateStr}\n`;
    });
    return lines;
}

/**
 * Build inline non-working suffix for resource lines from the table entries.
 * Returns string like "non-working [Annual Leave: 2026-03-01:2026-03-14, Doctor: 2026-04-01]"
 */
function buildResourceNwdSuffix(tbodyId) {
    const entries = getNwdEntriesFromTable(tbodyId);
    if (entries.length === 0) return '';
    const parts = entries.map(e => {
        const name = e.name || 'Untitled';
        const dateStr = e.finish ? `${e.start}:${e.finish}` : e.start;
        return `${name}: ${dateStr}`;
    });
    return `non-working [${parts.join(', ')}]`;
}

// Legacy compatibility wrappers

/**
 * Render a non-working day chip as a table row (legacy compatibility).
 * Used when loading old flat date format from front matter.
 */
function renderNonWorkingDayChip(dateStr, containerId) {
    // Map old container IDs to new table body IDs
    const tbodyMap = {
        'nonWorkingDaysList': 'nonWorkingDaysTableBody',
        'resourceNonWorkingDaysList': 'resourceNonWorkingDaysTableBody',
    };
    const tbodyId = tbodyMap[containerId];
    if (!tbodyId) return;

    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    // Check for duplicates in existing rows
    const existingRows = tbody.querySelectorAll('tr:not(.nwd-blank-row)');
    for (const row of existingRows) {
        const startInput = row.querySelectorAll('input')[1];
        if (startInput && startInput.value === dateStr) return;
    }

    // Remove the blank row, add the data row, then re-add blank
    const blankRow = tbody.querySelector('.nwd-blank-row');
    if (blankRow) blankRow.remove();
    addNwdTableRow(tbodyId, { name: '', start: dateStr, finish: '' }, false);
    addNwdTableRow(tbodyId, null, true);
}

/**
 * Get all non-working day dates from a table (legacy compatibility).
 * Returns a flat sorted array of date strings.
 */
function getNonWorkingDaysFromContainer(containerId) {
    const tbodyMap = {
        'nonWorkingDaysList': 'nonWorkingDaysTableBody',
        'resourceNonWorkingDaysList': 'resourceNonWorkingDaysTableBody',
    };
    const tbodyId = tbodyMap[containerId];
    if (!tbodyId) return [];

    const entries = getNwdEntriesFromTable(tbodyId);
    const dates = [];
    entries.forEach(e => {
        if (e.start) dates.push(e.start);
        // Note: for legacy compat, just return start dates
        // The full range expansion happens in the backend
    });
    dates.sort();
    return dates;
}

function addResourceRow(data = '') {
    const container = document.getElementById('resourcesList');
    const row = document.createElement('div');
    row.className = 'resource-row';
    row.style.cssText = 'display: flex; gap: 8px; margin-bottom: 8px;';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '@shortname, firstname lastname, role, email';
    input.value = data;
    input.style.cssText = 'flex: 1;';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = '✕';
    deleteBtn.className = 'btn-delete';
    deleteBtn.onclick = function() { row.remove(); };
    deleteBtn.style.cssText = 'background: #dc3545; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer;';

    row.appendChild(input);
    row.appendChild(deleteBtn);
    container.appendChild(row);
}

function addStakeholderRow(data = '') {
    const container = document.getElementById('stakeholdersList');
    const row = document.createElement('div');
    row.className = 'stakeholder-row';
    row.style.cssText = 'display: flex; gap: 8px; margin-bottom: 8px;';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '@shortname, firstname lastname, role, email';
    input.value = data;
    input.style.cssText = 'flex: 1;';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = '✕';
    deleteBtn.className = 'btn-delete';
    deleteBtn.onclick = function() { row.remove(); };
    deleteBtn.style.cssText = 'background: #dc3545; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer;';

    row.appendChild(input);
    row.appendChild(deleteBtn);
    container.appendChild(row);
}

// Auto-save project details with debounce
// Project details debounce state is now in state.js

function autoSaveProjectDetails() {
    // Clear existing timer
    if (projectDetailsDebounceTimer) {
        clearTimeout(projectDetailsDebounceTimer);
    }

    // Set new timer for 1 second debounce
    projectDetailsDebounceTimer = setTimeout(() => {
        saveProjectDetailsInternal(false); // Don't close modal on auto-save
    }, 1000);
}

function saveProjectDetails() {
    // Clear any pending auto-save
    if (projectDetailsDebounceTimer) {
        clearTimeout(projectDetailsDebounceTimer);
        projectDetailsDebounceTimer = null;
    }

    saveProjectDetailsInternal(true); // Close modal when explicitly saving
}

function saveProjectDetailsInternal(closeModal = true) {
    const editor = document.getElementById('planEditor');
    let content = editor.value;

    // Extract existing Resources, Key Stakeholders, Formatting, Theme, and Settings
    // from current editor to preserve any changes made via resource form, conditional formatting, etc.
    const existingResourcesSection = extractFrontMatterSection(content, 'Resources');
    const existingStakeholdersSection = extractFrontMatterSection(content, 'Key Stakeholders');
    const existingFormattingSection = extractFrontMatterSection(content, 'Formatting');
    const existingThemeSection = extractFrontMatterSection(content, 'Theme');
    const existingSettingsSection = extractFrontMatterIndentedSection(content, 'settings');

    // Collect form data
    const title = document.getElementById('projectTitle').value.trim();
    const manager = document.getElementById('projectManager').value.trim();
    const startDate = document.getElementById('projectStartDate').value.trim();
    const status = document.getElementById('projectStatus').value;
    const sponsor = document.getElementById('projectSponsor').value.trim();
    const description = document.getElementById('projectDescription').value.trim();
    const budget = document.getElementById('projectBudget').value.trim();
    const labelsInput = document.getElementById('projectLabels').value.trim();

    // Build front matter
    let frontMatter = '---\n';
    if (title) frontMatter += `title: ${title}\n`;
    if (manager) frontMatter += `project manager: ${manager}\n`;
    if (startDate) frontMatter += `start date: ${startDate}\n`;
    if (status && status !== 'Open') frontMatter += `status: ${status}\n`;
    if (sponsor) frontMatter += `sponsor: ${sponsor}\n`;
    if (description) frontMatter += `description: ${description}\n`;
    if (budget) frontMatter += `budget: ${budget}\n`;
    if (labelsInput) frontMatter += `labels: [${labelsInput}]\n`;

    // Add non-working days from the exceptions table
    const nwdFrontMatter = buildNwdFrontMatter('nonWorkingDaysTableBody');
    if (nwdFrontMatter) {
        frontMatter += nwdFrontMatter;
    }

    // Preserve existing Resources section from editor (don't overwrite)
    if (existingResourcesSection) {
        frontMatter += existingResourcesSection;
    }

    // Preserve existing Key Stakeholders section from editor (don't overwrite)
    if (existingStakeholdersSection) {
        frontMatter += existingStakeholdersSection;
    }

    // Preserve existing Formatting section from editor (don't overwrite)
    if (existingFormattingSection) {
        frontMatter += existingFormattingSection;
    }

    // Preserve existing Theme section from editor (don't overwrite kanban theme colours)
    if (existingThemeSection) {
        frontMatter += existingThemeSection;
    }

    // Preserve existing settings section from editor (#700)
    if (existingSettingsSection) {
        frontMatter += existingSettingsSection;
    }

    frontMatter += '---\n';

    // Remove existing front matter if present
    content = content.replace(/^---\s*\n[\s\S]*?\n---\n*/, '');

    // Add new front matter at the beginning
    editor.value = frontMatter + '\n' + content;

    // Trigger input event to update line numbers and render
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    // Close modal only if explicitly requested
    if (closeModal) {
        closeProjectDetailsForm();
    }
}

/**
 * Extract a specific section from front matter (e.g., Resources, Key Stakeholders)
 * Returns the section with its header and items, or null if not found
 */
function extractFrontMatterSection(content, sectionName) {
    const frontMatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!frontMatterMatch) return null;

    const frontMatterContent = frontMatterMatch[1];
    const lines = frontMatterContent.split('\n');

    let inSection = false;
    let sectionLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check if this line starts a new section
        if (line.trim().endsWith(':') && !line.includes('- ')) {
            const currentSectionName = line.trim().replace(':', '');

            if (currentSectionName === sectionName) {
                inSection = true;
                sectionLines.push(line);
            } else {
                // Different section - stop collecting if we were in our section
                if (inSection) {
                    break;
                }
            }
        } else if (inSection) {
            // Collect lines that are part of this section (list items or continuation)
            if (line.startsWith('- ') || line.trim() === '') {
                sectionLines.push(line);
            } else {
                // Hit a non-list item, non-empty line - section ended
                break;
            }
        }
    }

    return sectionLines.length > 0 ? sectionLines.join('\n') + '\n' : null;
}

/**
 * Extract a front matter section that uses indented key:value pairs (e.g. settings:).
 * Unlike extractFrontMatterSection which expects list items (- foo), this handles
 * sections where child lines are indented with spaces.
 */
function extractFrontMatterIndentedSection(content, sectionName) {
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;

    const lines = fmMatch[1].split('\n');
    let inSection = false;
    const sectionLines = [];

    for (const line of lines) {
        const trimmed = line.trim();

        // Check for section header
        if (trimmed.endsWith(':') && !trimmed.includes('- ') && !trimmed.startsWith('-')) {
            const name = trimmed.replace(':', '').toLowerCase();
            if (name === sectionName.toLowerCase()) {
                inSection = true;
                sectionLines.push(line);
                continue;
            } else if (inSection) {
                break;
            }
        }

        if (inSection) {
            // Indented lines (settings values) or empty lines belong to this section
            if (line.match(/^\s{2,}/) || trimmed === '') {
                sectionLines.push(line);
            } else {
                break;
            }
        }
    }

    return sectionLines.length > 0 ? sectionLines.join('\n') + '\n' : null;
}

/**
 * Remove a named section from front matter content, returning the remaining lines.
 * This avoids fragile string replacement that can fail on trailing newline mismatches.
 */
function removeFrontMatterSection(fmContent, sectionName) {
    const lines = fmContent.split('\n');
    const result = [];
    let inSection = false;

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.endsWith(':') && !trimmed.includes('- ')) {
            const name = trimmed.replace(':', '');
            if (name === sectionName) {
                inSection = true;
                continue;
            } else {
                inSection = false;
            }
        }

        if (inSection && (line.startsWith('- ') || trimmed === '')) {
            continue;
        }

        inSection = false;
        result.push(line);
    }

    return result.join('\n');
}

/**
 * Kanban Editor Panel Functions
 */

// Toggle main editor panel
function toggleMainEditor() {
    const panel = document.querySelector('.editor-panel');
    const splitter = document.getElementById('editorSplitter');
    const arrow = document.getElementById('editorSplitterArrow');

    if (panel && splitter && arrow) {
        const isCollapsed = panel.classList.contains('collapsed');

        if (isCollapsed) {
            // Expand to saved width or default
            panel.classList.remove('collapsed');
            splitter.classList.remove('collapsed');
            const savedWidth = localStorage.getItem('editorPanelWidth');
            if (savedWidth) {
                panel.style.width = savedWidth + 'px';
            } else {
                panel.style.width = EDITOR_DEFAULT_WIDTH_PERCENT + '%';
            }
            arrow.textContent = '\u25C0';
        } else {
            // Collapse - save current width first
            localStorage.setItem('editorPanelWidth', panel.offsetWidth);
            panel.classList.add('collapsed');
            splitter.classList.add('collapsed');
            arrow.textContent = '\u25B6';
        }

        window.dispatchEvent(new CustomEvent('editorPanelVisibilityChanged', {
            detail: { visible: !panel.classList.contains('collapsed') }
        }));

        // Re-render timeline and gantt after width change
        setTimeout(() => {
            if (timelineTasks.length > 0) {
                updateTimeline(timelineTasks, timelineProjectName);
            }
            if (ganttTasks && ganttTasks.length > 0) {
                renderGanttChart();
            }
            updateAllEmbeddedTimelines();
        }, 350); // Wait for collapse animation to complete
    }
}

// Toggle Kanban editor panel
function toggleKanbanEditor() {
    const panel = document.getElementById('kanbanEditorPanel');
    const splitter = document.getElementById('kanbanSplitter');
    const arrow = document.getElementById('kanbanSplitterArrow');

    if (panel && splitter && arrow) {
        const isCollapsed = panel.classList.contains('collapsed');

        if (isCollapsed) {
            // Expand
            panel.classList.remove('collapsed');
            splitter.classList.remove('collapsed');
            arrow.textContent = '◀';
        } else {
            // Collapse
            panel.classList.add('collapsed');
            splitter.classList.add('collapsed');
            arrow.textContent = '▶';
        }
    }
}

// Initialize Kanban editor sync
document.addEventListener('DOMContentLoaded', function() {
    const mainEditor = document.getElementById('planEditor');
    const kanbanEditor = document.getElementById('kanbanPlanEditor');

    if (mainEditor && kanbanEditor) {
        // Sync from main editor to kanban editor
        mainEditor.addEventListener('input', function() {
            if (kanbanEditor.value !== mainEditor.value) {
                kanbanEditor.value = mainEditor.value;
                // Trigger input event on Kanban editor to update line numbers
                kanbanEditor.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });

        // Sync from kanban editor to main editor
        kanbanEditor.addEventListener('input', function() {
            if (mainEditor.value !== kanbanEditor.value) {
                mainEditor.value = kanbanEditor.value;
                mainEditor.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });

        // Initial sync
        kanbanEditor.value = mainEditor.value;
        // Trigger input event to initialize line numbers
        kanbanEditor.dispatchEvent(new Event('input', { bubbles: true }));
    }
});

/**
 * Conditional Formatting System
 * Allows users to define rules that colour tasks in Gantt and Kanban views.
 * Rules are stored in the plan front matter under "Formatting:" section.
 */

// Conditional formatting state and colour constants are now in state.js

function isPastelColour(colour) {
    const value = String(colour || '').trim();
    const upper = value.toUpperCase();
    if (CF_PASTEL_COLOURS.includes(upper)) return true;

    // Use relative luminance for arbitrary custom colours, not just the
    // built-in pastel palette.  0.179 is the point where black and white
    // have equal WCAG contrast, so it also gives the more readable choice.
    let r, g, b;
    const hex = value.match(/^#([0-9a-f]{3,8})$/i);
    if (hex) {
        const digits = hex[1].length === 3
            ? hex[1].split('').map(ch => ch + ch).join('')
            : hex[1].slice(0, 6);
        if (digits.length === 6) {
            r = parseInt(digits.slice(0, 2), 16);
            g = parseInt(digits.slice(2, 4), 16);
            b = parseInt(digits.slice(4, 6), 16);
        }
    } else {
        const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (rgb) [r, g, b] = rgb.slice(1).map(Number);
    }
    if ([r, g, b].every(Number.isFinite)) {
        const channel = (n) => {
            n /= 255;
            return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b) > 0.179;
    }
    return false;
}

function getForegroundForColour(bgColour) {
    return isPastelColour(bgColour) ? '#000000' : '#FFFFFF';
}

function getConditionsForField(field) {
    const dateFields = ['Start', 'Finish'];
    const numericFields = ['% Complete', 'Duration'];

    if (dateFields.includes(field)) {
        return ['is before', 'is after', 'is before today', 'is after today'];
    }
    if (numericFields.includes(field)) {
        return ['is less than', 'is more than', 'equals'];
    }
    return ['contains', 'is exactly'];
}

function openConditionalFormattingPanel() {
    loadConditionalFormattingRulesFromFrontMatter();
    renderConditionalFormattingRules();
    populateCfColourPicker();
    openDetailPane('conditionalFormattingSection');
}

function populateCfColourPicker() {
    const pastelGrid = document.getElementById('cfPastelColours');
    const darkGrid = document.getElementById('cfDarkColours');
    if (!pastelGrid || !darkGrid) return;

    pastelGrid.innerHTML = '';
    darkGrid.innerHTML = '';

    CF_PASTEL_COLOURS.forEach(colour => {
        const swatch = document.createElement('div');
        swatch.className = 'cf-colour-option';
        swatch.style.backgroundColor = colour;
        swatch.title = colour;
        swatch.addEventListener('click', () => selectCfColour(colour));
        pastelGrid.appendChild(swatch);
    });

    CF_DARK_COLOURS.forEach(colour => {
        const swatch = document.createElement('div');
        swatch.className = 'cf-colour-option';
        swatch.style.backgroundColor = colour;
        swatch.title = colour;
        swatch.addEventListener('click', () => selectCfColour(colour));
        darkGrid.appendChild(swatch);
    });
}

function selectCfColour(colour) {
    if (cfActivePickerRowIndex === null) return;

    const rule = conditionalFormattingRules[cfActivePickerRowIndex];
    if (rule) {
        rule.colour = colour;
        saveConditionalFormattingRulesToFrontMatter();
        renderConditionalFormattingRules();
        hideCfColourPicker();
    }
}

function showCfColourPicker(rowIndex) {
    cfActivePickerRowIndex = rowIndex;
    const picker = document.getElementById('cfColourPicker');
    if (picker) {
        picker.style.display = 'block';

        // Highlight current selection
        const currentColour = conditionalFormattingRules[rowIndex]?.colour || '';
        picker.querySelectorAll('.cf-colour-option').forEach(opt => {
            opt.classList.toggle('selected', opt.style.backgroundColor === currentColour ||
                opt.title === currentColour);
        });
    }
}

function hideCfColourPicker() {
    cfActivePickerRowIndex = null;
    const picker = document.getElementById('cfColourPicker');
    if (picker) picker.style.display = 'none';
}

function addConditionalFormattingRule() {
    conditionalFormattingRules.push({
        field: 'Task Name',
        condition: 'contains',
        value: '',
        colour: '#FFE0B2'
    });
    saveConditionalFormattingRulesToFrontMatter();
    renderConditionalFormattingRules();
}

function deleteConditionalFormattingRule(index) {
    conditionalFormattingRules.splice(index, 1);
    saveConditionalFormattingRulesToFrontMatter();
    renderConditionalFormattingRules();
}

function moveConditionalFormattingRule(index, direction) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= conditionalFormattingRules.length) return;

    const rules = conditionalFormattingRules;
    [rules[index], rules[targetIndex]] = [rules[targetIndex], rules[index]];

    saveConditionalFormattingRulesToFrontMatter();
    renderConditionalFormattingRules();
}

function updateConditionalFormattingRule(index, field, value) {
    const rule = conditionalFormattingRules[index];
    if (!rule) return;

    rule[field] = value;

    // When field changes, reset condition to first available
    if (field === 'field') {
        const conditions = getConditionsForField(value);
        rule.condition = conditions[0];
    }

    saveConditionalFormattingRulesToFrontMatter();
    renderConditionalFormattingRules();
}

function renderConditionalFormattingRules() {
    const tbody = document.getElementById('cfRulesBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const fields = ['Task Name', 'Label', 'Start', 'Finish', '% Complete', 'Assigned To', 'Duration', 'RAG'];

    conditionalFormattingRules.forEach((rule, index) => {
        const row = document.createElement('tr');

        // Field selector
        const fieldCell = document.createElement('td');
        const fieldSelect = document.createElement('select');
        fields.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f;
            opt.textContent = f;
            opt.selected = rule.field === f;
            fieldSelect.appendChild(opt);
        });
        fieldSelect.addEventListener('change', () => updateConditionalFormattingRule(index, 'field', fieldSelect.value));
        fieldCell.appendChild(fieldSelect);
        row.appendChild(fieldCell);

        // Condition selector
        const condCell = document.createElement('td');
        const condSelect = document.createElement('select');
        const conditions = getConditionsForField(rule.field);
        conditions.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            opt.selected = rule.condition === c;
            condSelect.appendChild(opt);
        });
        condSelect.addEventListener('change', () => updateConditionalFormattingRule(index, 'condition', condSelect.value));
        condCell.appendChild(condSelect);
        row.appendChild(condCell);

        // Value input (not needed for "is before today"/"is after today")
        const valCell = document.createElement('td');
        if (!rule.condition.includes('today')) {
            const valInput = document.createElement('input');
            valInput.type = 'text';
            valInput.value = rule.value || '';
            valInput.placeholder = getValuePlaceholder(rule);
            valInput.addEventListener('change', () => updateConditionalFormattingRule(index, 'value', valInput.value));
            valCell.appendChild(valInput);
        } else {
            valCell.textContent = '-';
        }
        row.appendChild(valCell);

        // Colour swatch
        const colourCell = document.createElement('td');
        colourCell.className = 'cf-colour-cell';
        const swatch = document.createElement('span');
        swatch.className = 'cf-colour-swatch';
        swatch.style.backgroundColor = rule.colour || '#FFE0B2';
        swatch.addEventListener('click', () => showCfColourPicker(index));
        colourCell.appendChild(swatch);
        row.appendChild(colourCell);

        // Move up/down buttons
        const moveCell = document.createElement('td');
        moveCell.className = 'cf-move-cell';

        const upBtn = document.createElement('button');
        upBtn.className = 'cf-move-btn';
        upBtn.innerHTML = '&#9650;';
        upBtn.title = 'Move up (higher priority)';
        upBtn.disabled = index === 0;
        upBtn.addEventListener('click', () => moveConditionalFormattingRule(index, -1));
        moveCell.appendChild(upBtn);

        const downBtn = document.createElement('button');
        downBtn.className = 'cf-move-btn';
        downBtn.innerHTML = '&#9660;';
        downBtn.title = 'Move down (lower priority)';
        downBtn.disabled = index === conditionalFormattingRules.length - 1;
        downBtn.addEventListener('click', () => moveConditionalFormattingRule(index, 1));
        moveCell.appendChild(downBtn);

        row.appendChild(moveCell);

        // Delete button
        const delCell = document.createElement('td');
        const delBtn = document.createElement('button');
        delBtn.className = 'cf-delete-btn';
        delBtn.innerHTML = '&times;';
        delBtn.title = 'Delete rule';
        delBtn.addEventListener('click', () => deleteConditionalFormattingRule(index));
        delCell.appendChild(delBtn);
        row.appendChild(delCell);

        tbody.appendChild(row);
    });
}

function getValuePlaceholder(rule) {
    if (rule.field === 'Start' || rule.field === 'Finish') {
        return 'e.g. 2026-03-01 or today + 3d';
    }
    if (rule.field === '% Complete' || rule.field === 'Duration') {
        return 'e.g. 50';
    }
    return 'e.g. Design';
}

/**
 * Parse "today + 3d" or "today - 5d" or a date string into a Date.
 */
function parseCfDateValue(value) {
    if (!value) return null;
    const trimmed = value.trim().toLowerCase();

    const todayMatch = trimmed.match(/^today\s*([+-])\s*(\d+)d$/);
    if (todayMatch) {
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        const offset = parseInt(todayMatch[2]) * (todayMatch[1] === '+' ? 1 : -1);
        date.setDate(date.getDate() + offset);
        return date;
    }

    if (trimmed === 'today') {
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        return date;
    }

    // Try parsing as a date string
    const parsed = new Date(value.trim());
    if (!isNaN(parsed.getTime())) {
        parsed.setHours(0, 0, 0, 0);
        return parsed;
    }
    return null;
}

/**
 * Evaluate a single conditional formatting rule against a task.
 * Returns true if the rule matches.
 */
function evaluateCfRule(rule, task) {
    const field = rule.field;
    const condition = rule.condition;
    const value = rule.value || '';

    let taskValue = getTaskFieldValue(task, field);
    if (taskValue === null || taskValue === undefined) return false;

    switch (condition) {
        case 'contains': {
            const tv = String(taskValue).toLowerCase();
            const rv = value.toLowerCase();
            return tv.includes(rv);
        }
        case 'is exactly': {
            const tv = String(taskValue).toLowerCase();
            const rv = value.toLowerCase();
            return tv === rv;
        }
        case 'is before today': {
            const taskDate = parseDateToLocal(taskValue);
            if (!taskDate) return false;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return taskDate < today;
        }
        case 'is after today': {
            const taskDate = parseDateToLocal(taskValue);
            if (!taskDate) return false;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return taskDate > today;
        }
        case 'is before': {
            const taskDate = parseDateToLocal(taskValue);
            const compareDate = parseCfDateValue(value);
            if (!taskDate || !compareDate) return false;
            return taskDate < compareDate;
        }
        case 'is after': {
            const taskDate = parseDateToLocal(taskValue);
            const compareDate = parseCfDateValue(value);
            if (!taskDate || !compareDate) return false;
            return taskDate > compareDate;
        }
        case 'is less than': {
            const num = parseFloat(String(taskValue).replace('%', ''));
            const target = parseFloat(value);
            if (isNaN(num) || isNaN(target)) return false;
            return num < target;
        }
        case 'is more than': {
            const num = parseFloat(String(taskValue).replace('%', ''));
            const target = parseFloat(value);
            if (isNaN(num) || isNaN(target)) return false;
            return num > target;
        }
        case 'equals': {
            const num = parseFloat(String(taskValue).replace('%', ''));
            const target = parseFloat(value);
            if (isNaN(num) || isNaN(target)) return false;
            return num === target;
        }
        default:
            return false;
    }
}

function parseDateToLocal(dateStr) {
    if (!dateStr || dateStr === '-') return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
}

function getTaskFieldValue(task, field) {
    switch (field) {
        case 'Task Name': return task.name;
        case 'Label': return task.labels || '';
        case 'Start': return task.start || task.startDate || '';
        case 'Finish': return task.finish || task.finishDate || '';
        case '% Complete': return task.percent ? String(task.percent).replace('%', '') : '0';
        case 'Assigned To': return task.resources || '';
        case 'Duration': return task.duration_days !== undefined ? String(task.duration_days) : (task.duration || '0');
        case 'RAG': return task.rag || '';
        default: return null;
    }
}

/**
 * Get the formatting (background + foreground colour) for a task based on rules.
 * First matching rule wins.
 */
function getConditionalFormatting(task) {
    for (const rule of conditionalFormattingRules) {
        if (!rule.colour || (!rule.value && !rule.condition.includes('today'))) continue;
        if (evaluateCfRule(rule, task)) {
            return {
                backgroundColor: rule.colour,
                color: getForegroundForColour(rule.colour)
            };
        }
    }
    return null;
}

/**
 * Parse conditional formatting rules from plan front matter.
 * Format: Formatting:
 *   - Task Name contains "Design" -> #FFE0B2
 *   - Start is after today -> #E65100
 */
function loadConditionalFormattingRulesFromFrontMatter() {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const content = editor.value;
    const frontMatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!frontMatterMatch) {
        conditionalFormattingRules = [];
        return;
    }

    const lines = frontMatterMatch[1].split('\n');
    const rules = [];
    let inFormatting = false;

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.toLowerCase() === 'formatting:') {
            inFormatting = true;
            continue;
        }

        // New section header ends formatting section
        if (inFormatting && trimmed.match(/^[a-z\s]+:/i) && !trimmed.startsWith('-')) {
            break;
        }

        if (inFormatting && trimmed.startsWith('-')) {
            const rule = parseCfRuleLine(trimmed.substring(1).trim());
            if (rule) rules.push(rule);
        }
    }

    conditionalFormattingRules = rules;
}

/**
 * Parse a single rule line like: Task Name contains "Design" -> #FFE0B2
 */
function parseCfRuleLine(line) {
    const arrowIndex = line.lastIndexOf('->');
    if (arrowIndex === -1) return null;

    const leftPart = line.substring(0, arrowIndex).trim();
    const colour = line.substring(arrowIndex + 2).trim();

    // Match: field condition "value" OR field condition value OR field condition
    const fields = ['Task Name', 'Label', 'Start', 'Finish', '% Complete', 'Assigned To', 'Duration', 'RAG'];
    const conditions = ['contains', 'is exactly', 'is before today', 'is after today', 'is before', 'is after', 'is less than', 'is more than', 'equals'];

    // Sort conditions longest first for greedy matching
    const sortedConditions = [...conditions].sort((a, b) => b.length - a.length);

    for (const field of fields) {
        if (!leftPart.startsWith(field)) continue;
        const rest = leftPart.substring(field.length).trim();

        for (const cond of sortedConditions) {
            if (!rest.startsWith(cond)) continue;
            let value = rest.substring(cond.length).trim();
            // Remove surrounding quotes if present
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            return { field, condition: cond, value, colour };
        }
    }
    return null;
}

/**
 * Save conditional formatting rules to plan front matter.
 */
function saveConditionalFormattingRulesToFrontMatter() {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    let content = editor.value;

    // Build new formatting section
    let formattingSection = '';
    if (conditionalFormattingRules.length > 0) {
        formattingSection = 'Formatting:\n';
        for (const rule of conditionalFormattingRules) {
            const valueStr = rule.value ? ` "${rule.value}"` : '';
            formattingSection += `- ${rule.field} ${rule.condition}${valueStr} -> ${rule.colour}\n`;
        }
    }

    // Replace existing formatting in front matter or add it
    const frontMatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (frontMatterMatch) {
        const fmContent = removeFrontMatterSection(frontMatterMatch[1], 'Formatting');

        // Add new formatting section if there are rules
        let newContent = fmContent.trimEnd();
        if (formattingSection) {
            newContent += '\n' + formattingSection;
        }

        const newFrontMatter = '---\n' + newContent.trim() + '\n---';
        content = content.replace(/^---\s*\n[\s\S]*?\n---/, newFrontMatter);
    } else if (formattingSection) {
        // No front matter exists, create one
        content = '---\n' + formattingSection + '---\n\n' + content;
    }

    editor.value = content;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * RAID Log System
 * Tracks Risks, Actions, Issues, Decisions, and Dependencies
 */

// RAID state is now in state.js

/**
 * Clear RAID log entries from the UI and global state.
 * This should be called before loading a new plan to ensure
 * old RAID entries don't persist.
 */
function clearRaidLogEntries() {
    raidItems = [];
    raidNextId = 1;

    // Re-render the RAID table to show empty state
    renderRaidTable();

    console.log('Cleared RAID log entries');
}

function addRaidItem() {
    openRaidForm(null);
}

function openRaidForm(itemId) {
    const title = document.getElementById('raidFormTitle');
    const idField = document.getElementById('raidItemId');

    const deleteRow = document.getElementById('raidDeleteButtonRow');

    if (itemId != null) {
        const item = raidItems.find(i => i.id === itemId);
        if (!item) return;

        title.textContent = 'Edit RAID Item';
        idField.value = item.id;
        document.getElementById('raidItemType').value = item.type;
        document.getElementById('raidItemStatus').value = item.status;
        document.getElementById('raidItemTitle').value = item.title;
        document.getElementById('raidItemDescription').value = item.description;
        document.getElementById('raidItemRaisedBy').value = item.raised_by;
        document.getElementById('raidItemOwner').value = item.owner;
        document.getElementById('raidItemMitigation').value = item.mitigation_actions;
        document.getElementById('raidItemImpact').value = item.impact;
        document.getElementById('raidItemLikelihood').value = item.likelihood;
        document.getElementById('raidItemEscalation').value = item.escalation_level || 'project';
        if (deleteRow) deleteRow.style.display = 'block';
    } else {
        title.textContent = 'New RAID Item';
        idField.value = '';
        document.getElementById('raidItemType').value = 'risk';
        document.getElementById('raidItemStatus').value = 'open';
        document.getElementById('raidItemTitle').value = '';
        document.getElementById('raidItemDescription').value = '';
        document.getElementById('raidItemRaisedBy').value = '';
        document.getElementById('raidItemOwner').value = '';
        document.getElementById('raidItemMitigation').value = '';
        document.getElementById('raidItemImpact').value = '3';
        document.getElementById('raidItemLikelihood').value = '3';
        document.getElementById('raidItemEscalation').value = 'project';
        if (deleteRow) deleteRow.style.display = 'none';
    }

    updateRaidFormScore();
    openDetailPane('raidFormSection');
}

function closeRaidForm() {
    closeDetailPane();
}

function updateRaidFormScore() {
    const impact = parseInt(document.getElementById('raidItemImpact').value) || 3;
    const likelihood = parseInt(document.getElementById('raidItemLikelihood').value) || 3;
    const score = impact * likelihood;
    const display = document.getElementById('raidScoreDisplay');

    display.textContent = score;
    display.className = 'raid-score-display';

    if (score >= 16) {
        display.classList.add('score-high');
    } else if (score >= 6) {
        display.classList.add('score-medium');
    } else {
        display.classList.add('score-low');
    }
}

function saveRaidItemFromForm() {
    const idField = document.getElementById('raidItemId').value;
    const title = document.getElementById('raidItemTitle').value.trim();

    if (!title) {
        alert('Please enter a title for the RAID item.');
        return;
    }

    const impact = parseInt(document.getElementById('raidItemImpact').value);
    const likelihood = parseInt(document.getElementById('raidItemLikelihood').value);
    const escalationLevel = document.getElementById('raidItemEscalation').value;

    const itemData = {
        type: document.getElementById('raidItemType').value,
        title: title,
        description: document.getElementById('raidItemDescription').value.trim(),
        raised_by: document.getElementById('raidItemRaisedBy').value.trim(),
        owner: document.getElementById('raidItemOwner').value.trim(),
        mitigation_actions: document.getElementById('raidItemMitigation').value.trim(),
        impact: impact,
        likelihood: likelihood,
        score: impact * likelihood,
        status: document.getElementById('raidItemStatus').value,
        escalated: escalationLevel !== 'project',
        escalation_level: escalationLevel
    };

    if (idField) {
        const existingId = parseInt(idField);
        const index = raidItems.findIndex(i => i.id === existingId);
        if (index >= 0) {
            raidItems[index] = { ...raidItems[index], ...itemData };
        }
    } else {
        itemData.id = raidNextId++;
        raidItems.push(itemData);
    }

    closeRaidForm();
    renderRaidTable();
    syncRaidLogToPlanText();
    updateReportRaid();
}

function deleteRaidItem(id) {
    if (!confirm('Are you sure you want to delete this RAID item?')) return;
    raidItems = raidItems.filter(i => i.id !== id);
    renderRaidTable();
    syncRaidLogToPlanText();
    updateReportRaid();
}

// raidItemPendingDeleteId is now in state.js

function confirmDeleteRaidItem() {
    const idField = document.getElementById('raidItemId').value;
    if (!idField) return;

    raidItemPendingDeleteId = parseInt(idField);
    const item = raidItems.find(i => i.id === raidItemPendingDeleteId);
    const itemTitle = item ? item.title : 'this item';

    const msg = document.getElementById('raidDeleteConfirmMessage');
    if (msg) {
        msg.textContent = 'Are you sure you want to delete "' + itemTitle + '"? This action cannot be undone.';
    }

    const overlay = document.getElementById('raidDeleteConfirmOverlay');
    if (overlay) overlay.classList.add('active');
}

function cancelDeleteRaidItem() {
    raidItemPendingDeleteId = null;
    const overlay = document.getElementById('raidDeleteConfirmOverlay');
    if (overlay) overlay.classList.remove('active');
}

function executeDeleteRaidItem() {
    if (raidItemPendingDeleteId == null) return;

    raidItems = raidItems.filter(i => i.id !== raidItemPendingDeleteId);
    raidItemPendingDeleteId = null;

    const overlay = document.getElementById('raidDeleteConfirmOverlay');
    if (overlay) overlay.classList.remove('active');

    closeRaidForm();
    renderRaidTable();
    syncRaidLogToPlanText();
    updateReportRaid();
}

function renderRaidTable() {
    try {
    const tbody = document.getElementById('raidTableBody');
    const emptyState = document.getElementById('raidEmptyState');
    if (!tbody || !emptyState) {
        console.warn('RAID table elements not found in DOM');
        return;
    }
    const filterTypeEl = document.getElementById('raidFilterType');
    const filterStatusEl = document.getElementById('raidFilterStatus');
    const filterType = filterTypeEl ? filterTypeEl.value : 'all';
    const filterStatus = filterStatusEl ? filterStatusEl.value : 'all';

    let filtered = raidItems.filter(item => {
        if (filterType !== 'all' && item.type !== filterType) return false;
        if (filterStatus !== 'all' && item.status !== filterStatus) return false;
        return true;
    });

    filtered.sort((a, b) => {
        let valA = a[raidSortColumn];
        let valB = b[raidSortColumn];

        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();

        if (valA < valB) return raidSortAsc ? -1 : 1;
        if (valA > valB) return raidSortAsc ? 1 : -1;
        return 0;
    });

    tbody.innerHTML = '';

    if (raidItems.length === 0) {
        emptyState.hidden = false;
        document.getElementById('raidTable').style.display = 'none';
        renderEscalationsView();
        return;
    }

    emptyState.hidden = true;
    document.getElementById('raidTable').style.display = 'table';

    filtered.forEach(item => {
        try {
        const row = document.createElement('tr');

        const scoreClass = item.score >= 16 ? 'raid-score-high' : item.score >= 6 ? 'raid-score-medium' : 'raid-score-low';

        row.innerHTML = `
            <td>${item.id || ''}</td>
            <td><span class="raid-type-badge raid-type-${item.type || 'risk'}">${item.type || 'risk'}</span></td>
            <td title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</td>
            <td title="${escapeHtml(item.description)}">${escapeHtml(item.description)}</td>
            <td>${escapeHtml(item.raised_by)}</td>
            <td>${escapeHtml(item.owner)}</td>
            <td title="${escapeHtml(item.mitigation_actions)}">${escapeHtml(item.mitigation_actions)}</td>
            <td>${item.impact || ''}</td>
            <td>${item.likelihood || ''}</td>
            <td><span class="raid-score ${scoreClass}">${item.score || ''}</span></td>
            <td>
                <span class="raid-status-badge raid-status-${item.status || 'open'}">${item.status || 'open'}</span>
                ${item.escalated ? `<span class="raid-escalation-badge raid-escalation-${item.escalation_level}" title="Escalated to ${escapeHtml(item.escalation_level)}">&#9650; ${escapeHtml(item.escalation_level)}</span>` : ''}
            </td>
            <td>
                <np-button icon-only variant="neutral" size="small" title="Edit" label="Edit" onclick="openRaidForm(${item.id})"><span slot="icon">✏️</span></np-button>
                <np-button icon-only variant="neutral" size="small" title="Open source row in plan editor" label="Open source row in plan editor" onclick="SectionFolding.jumpToBackMatterSection('---raid log---', ${item.id}, 'tasks')"><i class="bi bi-code-slash" slot="icon"></i></np-button>
                <np-button icon-only variant="danger" size="small" title="Delete" label="Delete" onclick="deleteRaidItem(${item.id})"><span slot="icon">🗑️</span></np-button>
            </td>
        `;
        tbody.appendChild(row);
        } catch (itemError) {
            console.warn('Skipping malformed RAID item during render:', item, itemError);
        }
    });

    renderEscalationsView();

    updateRaidSortIndicators();
    updateRaidMarkdownEditor();
    syncRaidLogToPlanText();
    } catch (error) {
        console.error('Error rendering RAID table:', error);
    }
}

/** Normalize a RAID item's "Escalate To" value to 'board' / 'programme' /
 * '' (not escalated, or escalated only to 'project'). 'program' is folded
 * into 'programme' -- some imported/legacy rows use the US spelling. */
function normalizedEscalationTarget(item) {
    const target = String(item.escalation_level || item.escalate_to || '').trim().toLowerCase();
    if (target === 'board') return 'board';
    if (target === 'programme' || target === 'program') return 'programme';
    return '';
}

/**
 * Render risks escalated to the Board or Programme (#1096). This is
 * deliberately narrower than the RAID log: it only ever shows RAID items
 * of type 'risk' -- issues, actions, decisions and dependencies can carry
 * an escalation_level too (see aggregateEscalatedRaidItems() in
 * programme.js, which rolls up risks *and* issues for the programme
 * dashboard), but the Escalations view named in #1090/#1096 is specifically
 * about risks raised for Board/Programme attention.
 */
function renderEscalationsView() {
    const body = document.getElementById('escalationsTableBody');
    const empty = document.getElementById('escalationsEmptyState');
    if (!body) return;

    const filterEl = document.getElementById('escalationsFilterTarget');
    const filterTarget = filterEl ? String(filterEl.value || 'all').trim().toLowerCase() : 'all';

    const escalated = (raidItems || []).filter(item => {
        if (String(item.type || '').trim().toLowerCase() !== 'risk') return false;
        const target = normalizedEscalationTarget(item);
        if (!target) return false;
        if (filterTarget !== 'all' && target !== filterTarget) return false;
        return true;
    });

    body.innerHTML = escalated.map(item => {
        const target = normalizedEscalationTarget(item);
        const targetLabel = target.charAt(0).toUpperCase() + target.slice(1);
        const scoreClass = item.score >= 16 ? 'raid-score-high' : item.score >= 6 ? 'raid-score-medium' : 'raid-score-low';
        return `
        <tr>
            <td><button class="link-button" type="button" onclick="openRaidForm(${Number(item.id)})">${escapeHtml(item.title || '')}</button></td>
            <td>${escapeHtml(item.description || '')}</td>
            <td>${escapeHtml(item.owner || '')}</td>
            <td><span class="raid-score ${scoreClass}">${item.score || ''}</span></td>
            <td><span class="raid-escalation-badge raid-escalation-${target}">${escapeHtml(targetLabel)}</span></td>
            <td>${escapeHtml(item.target_date || '')}</td>
            <td><span class="raid-status-badge raid-status-${item.status || 'open'}">${escapeHtml(item.status || 'open')}</span></td>
        </tr>`;
    }).join('');
    if (empty) empty.hidden = escalated.length > 0;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function sortRaidTable(column) {
    if (raidSortColumn === column) {
        raidSortAsc = !raidSortAsc;
    } else {
        raidSortColumn = column;
        raidSortAsc = true;
    }
    renderRaidTable();
}

function updateRaidSortIndicators() {
    const headers = document.querySelectorAll('.raid-table th');
    headers.forEach(th => {
        const indicator = th.querySelector('.sort-indicator');
        if (indicator) {
            const onclick = th.getAttribute('onclick');
            if (onclick && onclick.includes(`'${raidSortColumn}'`)) {
                indicator.textContent = raidSortAsc ? '▲' : '▼';
            } else {
                indicator.textContent = '';
            }
        }
    });
}

function generateRaidMarkdown() {
    if (raidItems.length === 0) return '# RAID Log\n\n*No items.*\n';

    let headers = ['ID', 'Type', 'Title', 'Description', 'Raised By', 'Owner', 'Mitigation Actions', 'Impact', 'Likelihood', 'Score', 'Status'];

    const escPipe = (text) => String(text || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

    const includeEscalation = raidItems.some(item => item.escalated || (item.escalation_level && item.escalation_level !== 'project'));
    if (includeEscalation) headers = headers.concat(['Escalated', 'Escalation Level']);

    const rows = raidItems.map(item => {
        const row = [
            String(item.id),
            item.type.charAt(0).toUpperCase() + item.type.slice(1),
            escPipe(item.title),
            escPipe(item.description),
            escPipe(item.raised_by),
            escPipe(item.owner),
            escPipe(item.mitigation_actions),
            String(item.impact),
            String(item.likelihood),
            String(item.score),
            item.status.charAt(0).toUpperCase() + item.status.slice(1)
        ];
        if (includeEscalation) {
            row.push(item.escalated ? 'yes' : 'no');
            row.push(item.escalation_level || 'project');
        }
        return row;
    });

    const widths = headers.map(h => h.length);
    rows.forEach(row => {
        row.forEach((cell, i) => {
            widths[i] = Math.max(widths[i], cell.length);
        });
    });

    const pad = (str, width) => str + ' '.repeat(Math.max(0, width - str.length));
    const formatRow = (cells) => '| ' + cells.map((c, i) => pad(c, widths[i])).join(' | ') + ' |';
    const separator = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';

    let md = '# RAID Log\n\n';
    md += formatRow(headers) + '\n';
    md += separator + '\n';
    rows.forEach(row => {
        md += formatRow(row) + '\n';
    });

    return md;
}

function parseRaidMarkdown(text) {
    try {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        // Find header row - accept any row containing a pipe and at least one
        // recognised keyword (id, title, type, or description).  This matches
        // both the full format (ID | Type | Title | ...) and the simple plan
        // sync format (Type | Description | Status | ...).
        let headerIndex = -1;
        const headerKeywords = ['id', 'title', 'type', 'description'];
        for (let i = 0; i < lines.length; i++) {
            const lower = lines[i].toLowerCase();
            if (lower.includes('|') && headerKeywords.some(kw => lower.includes(kw))) {
                headerIndex = i;
                break;
            }
        }

        if (headerIndex === -1) return [];

        const parseRow = (line) => {
            // Split on unescaped pipes, removing first/last empty entries
            const parts = line.split(/(?<!\\)\|/).map(cell => cell.trim());
            return parts.filter((cell, idx, arr) => idx > 0 && idx < arr.length - 1 || (cell.length > 0 && idx > 0));
        };

        const headers = parseRow(lines[headerIndex]).map(h => h.toLowerCase());

        // Build column mapping with standard aliases first
        const colMap = {};
        const standardAliases = {
            'id': 'id', 'type': 'type',
            'raised by': 'raised_by',
            'owner': 'owner', 'mitigation actions': 'mitigation_actions',
            'impact': 'impact', 'likelihood': 'likelihood',
            'score': 'score', 'status': 'status',
            'date': 'date',
            'escalated': 'escalated', 'escalation level': 'escalation_level'
        };

        headers.forEach((h, idx) => {
            for (const [alias, field] of Object.entries(standardAliases)) {
                if (h.includes(alias)) {
                    colMap[field] = idx;
                    break;
                }
            }
        });

        // Handle title/description mapping with explicit logic:
        // If "title" column exists, map it to 'title'
        // If "description" column exists, map it to 'description'
        // If "description" exists but "title" doesn't, also use description for title (simple format)
        let hasTitleCol = false;
        let hasDescCol = false;

        headers.forEach((h, idx) => {
            if (h.includes('title') && !('title' in colMap)) {
                colMap['title'] = idx;
                hasTitleCol = true;
            }
            if (h.includes('description') && !('description' in colMap)) {
                colMap['description'] = idx;
                hasDescCol = true;
            }
        });

        // Simple format fallback: use description column for title
        if (!hasTitleCol && hasDescCol && !('title' in colMap)) {
            colMap['title'] = colMap['description'];
        }

        const items = [];
        const validTypes = ['risk', 'action', 'issue', 'decision', 'dependency'];
        const validStatuses = ['open', 'closed', 'transferred'];
        let maxIdSeen = 0;

        for (let i = headerIndex + 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line.includes('|')) continue;
            if (line.replace(/[|\-\s]/g, '').length === 0) continue;

            try {
                const cells = parseRow(line);
                if (cells.length === 0) continue;

                const getCell = (field, def) => {
                    const idx = colMap[field];
                    if (idx !== undefined && idx < cells.length) {
                        return cells[idx].replace(/\\\|/g, '|');
                    }
                    return def;
                };

                const itemType = (getCell('type', 'risk') || 'risk').toLowerCase();
                let itemStatus = (getCell('status', 'open') || 'open').toLowerCase();
                if (itemStatus.includes('transferred')) itemStatus = 'transferred';

                // Try to get score directly, derive impact/likelihood
                let impact, likelihood, score;
                const scoreStr = getCell('score', '');
                if (scoreStr) {
                    score = parseInt(scoreStr) || 9;
                    impact = Math.max(1, Math.min(5, parseInt(getCell('impact', '3')) || 3));
                    likelihood = Math.max(1, Math.min(5, parseInt(getCell('likelihood', '3')) || 3));
                } else {
                    impact = Math.max(1, Math.min(5, parseInt(getCell('impact', '3')) || 3));
                    likelihood = Math.max(1, Math.min(5, parseInt(getCell('likelihood', '3')) || 3));
                    score = impact * likelihood;
                }

                // Generate ID: use provided ID if valid, otherwise auto-assign
                const idStr = getCell('id', '');
                let itemId;
                if (idStr) {
                    itemId = parseInt(idStr);
                    if (isNaN(itemId)) itemId = maxIdSeen + 1;
                } else {
                    itemId = maxIdSeen + 1;
                }
                maxIdSeen = Math.max(maxIdSeen, itemId);

                const escalated = (getCell('escalated', '') || '').toLowerCase();
                let escalationLevel = (getCell('escalation_level', '') || '').toLowerCase();
                if (!['project', 'programme', 'board'].includes(escalationLevel)) escalationLevel = 'project';

                items.push({
                    id: itemId,
                    type: validTypes.includes(itemType) ? itemType : 'risk',
                    title: getCell('title', ''),
                    description: getCell('description', ''),
                    raised_by: getCell('raised_by', ''),
                    owner: getCell('owner', ''),
                    mitigation_actions: getCell('mitigation_actions', ''),
                    impact: impact,
                    likelihood: likelihood,
                    score: score,
                    status: validStatuses.includes(itemStatus) ? itemStatus : 'open',
                    escalated: ['yes', 'true', '1'].includes(escalated),
                    escalation_level: escalationLevel
                });
            } catch (rowError) {
                console.warn('Skipping malformed RAID row:', line, rowError);
                continue;
            }
        }

        return items;
    } catch (error) {
        console.error('Error parsing RAID markdown:', error);
        return [];
    }
}

/**
 * Extract the RAID log section text from plan text.
 * Returns the text after the ---raid log--- marker, or empty string if absent.
 */
function extractRaidLogFromPlanText(planText) {
    if (!planText) return '';
    const marker = '---raid log---';
    const idx = planText.indexOf(marker);
    if (idx === -1) return '';
    const afterMarker = idx + marker.length;

    // Stop at the next section marker (budget, comms, lessons learned,
    // baseline, or whiteboard) if present. This must match every other
    // section marker (comms in particular) so that a comms plan following
    // the RAID log is never swept into the extracted RAID log text -- see
    // #978.
    let endIdx = planText.length;
    for (const sectionMarker of [BUDGET_START, COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START]) {
        const mIdx = planText.indexOf(sectionMarker, afterMarker);
        if (mIdx !== -1 && mIdx < endIdx) {
            endIdx = mIdx;
        }
    }
    return planText.substring(afterMarker, endIdx).trim();
}

/**
 * Load RAID items from parsed data (API response or plan text fallback).
 * Populates the global raidItems array and renders the table.
 * Only loads if items are found and raidItems is currently empty,
 * to avoid overwriting user edits.
 */
function loadRaidItemsFromData(items) {
    try {
        if (!items || items.length === 0) return;
        // Only populate if RAID tab is currently empty to avoid
        // overwriting manual edits during the same session.
        if (raidItems.length > 0) return;

        raidItems = items;
        raidNextId = Math.max(...items.map(i => i.id || 0)) + 1;
        renderRaidTable();

        // Update action tracker views with actions from RAID log
        renderActionsTable();
        updateReportActions();
        updateResourceFilter();
    } catch (error) {
        console.error('Error loading RAID items:', error);
    }
}

/**
 * Extract RAID items from plan text on the client side.
 * This is a fallback when the backend /api/parse endpoint does not
 * return RAID items.
 */
function extractRaidItemsFromPlanText(planText) {
    try {
        const raidText = extractRaidLogFromPlanText(planText);
        if (!raidText) return [];
        return parseRaidMarkdown(raidText);
    } catch (error) {
        console.error('Error extracting RAID items from plan text:', error);
        return [];
    }
}

function downloadRaidMarkdown() {
    const content = generateRaidMarkdown();

    if (raidItems.length === 0) {
        alert('No RAID items to download. Add some items first.');
        return;
    }

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'raid.md';
    document.body.appendChild(a);
    a.click();

    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

function uploadRaidMarkdown(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.match(/\.(md|txt)$/i)) {
        alert('Please select a Markdown (.md) or text (.txt) file.');
        event.target.value = '';
        return;
    }

    file.text().then(text => {
        const items = parseRaidMarkdown(text);
        if (items.length === 0) {
            alert('No RAID items found in the file. Please check the format.');
        } else {
            raidItems = items;
            raidNextId = Math.max(...items.map(i => i.id)) + 1;
            renderRaidTable();
        }
        event.target.value = '';
    });
}

async function exportRaidExcel() {
    if (raidItems.length === 0) {
        alert('No RAID items to export. Add some items first.');
        return;
    }

    if (browserExcelExportsEnabled()) {
        try {
            const module = await import('/static/browser-excel.js');
            await module.exportRaidExcelInBrowser(raidItems, { projectName: 'RAID', filename: 'raid.xlsx' });
            return;
        } catch (error) {
            console.error('Browser RAID export failed, falling back to backend:', error);
        }
    }

    try {
        const response = await fetch('/api/raid/export-excel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                items: raidItems,
                project_name: 'RAID'
            })
        });

        if (!response.ok) {
            throw new Error('Export failed');
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'raid.xlsx';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    } catch (error) {
        alert('Failed to export to Excel: ' + error.message);
    }
}

// RAID Excel is a registered sync target (issue #761, extended by its
// sync-file-linking follow-up). This target's key into LocalFileAccess's
// per-target handle map (local-file-access.js) -- distinct from the main
// plan file's default 'plan' target, and from MSP_SYNC_TARGET_KEY below.
const RAID_SYNC_TARGET_KEY = 'raid-excel';
const RAID_XLSX_PICKER_OPTIONS = {
    id: 'noodleplanner-raid-excel',
    types: [{
        description: 'RAID Excel workbook',
        accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
    }],
    excludeAcceptAllOption: false,
    multiple: false,
};

// Rather than blindly overwriting raidItems with whatever the workbook
// contains, read it, diff it against the current plan and the last-synced
// snapshot, and let the user review additions/updates/removals/conflicts
// before anything is applied. This is the plain upload-input path (the
// hidden #raidXlUpload input, and the Firefox/Safari fallback from
// syncRaidExcelTarget below); processRaidExcelSyncInput does the actual
// import work shared with the linked-handle path.
async function uploadRaidExcel(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    await processRaidExcelSyncInput(file, file.name);
}

/**
 * Entry point for the Settings > Sync tab's "Sync Now" button on the RAID
 * Excel target -- the fix for issue #761's follow-up report that sync never
 * remembered which file to sync to, so every sync opened a fresh OS picker.
 *
 * MUST run as a direct click handler with no prior await: re-granting a
 * revoked permission (LocalFileAccess.requestWritePermission) needs
 * transient user activation, which doesn't survive unrelated awaits before
 * it. The path taken depends purely on LocalFileAccess's current state for
 * this project/target -- there's no separate "is this the first sync?" flag
 * to keep in sync with it:
 *
 *   - unsupported (Firefox/Safari, no File System Access API): falls back
 *     to the plain upload input, same as before -- there's no one-click
 *     story possible there, and this says so.
 *   - needs-relink (a handle survived reload but permission wasn't
 *     restored, or a previous write failed): asks for permission again on
 *     the SAME handle first; only opens a fresh picker if that's refused.
 *   - unlinked: opens the native picker and links the chosen file for next
 *     time.
 *   - linked: reads straight from the handle -- genuinely one click, no
 *     dialog of any kind.
 */
async function syncRaidExcelTarget() {
    const projectId = (typeof getCurrentProjectId === 'function' && getCurrentProjectId()) || 'default';

    if (typeof LocalFileAccess === 'undefined' || !LocalFileAccess.isSupported()) {
        if (typeof showToast === 'function') {
            showToast('This browser can’t link Sync to a file on disk — choose the Excel file each time instead.', 'info');
        }
        document.getElementById('raidXlUpload')?.click();
        return;
    }

    await LocalFileAccess.ensureRestored(projectId);
    let status = LocalFileAccess.getLinkStatus(projectId, RAID_SYNC_TARGET_KEY);

    if (status === 'needs-relink') {
        const granted = await LocalFileAccess.requestWritePermission(projectId, RAID_SYNC_TARGET_KEY);
        status = granted ? 'linked' : 'unlinked';
    }

    if (status === 'linked') {
        let read = null;
        try {
            read = await LocalFileAccess.readLinkedFile(projectId, RAID_SYNC_TARGET_KEY, 'arraybuffer');
        } catch (error) {
            console.error('Could not read linked RAID Excel file:', error);
            // readLinkedFile() already dropped the link on a hard failure
            // (or flagged needs-relink on a permission failure); either way
            // fall through to a fresh picker below instead of leaving the
            // user stuck on an error.
        }
        if (read) {
            await processRaidExcelSyncInput(read.content, read.name);
            return;
        }
    }

    let picked;
    try {
        picked = await LocalFileAccess.pickAndLinkFile(projectId, RAID_SYNC_TARGET_KEY, RAID_XLSX_PICKER_OPTIONS, 'arraybuffer');
    } catch (error) {
        showMessage('editor', 'error', 'Failed to open RAID Excel file: ' + error.message);
        return;
    }
    if (!picked) return; // user cancelled the picker

    await processRaidExcelSyncInput(picked.content, picked.name);
}

/**
 * Shared by uploadRaidExcel (a File, from the plain upload input) and
 * syncRaidExcelTarget (raw bytes, from a linked handle) --
 * browser-excel.js's loadWorkbookInput() accepts either a File or an
 * ArrayBuffer.
 */
async function processRaidExcelSyncInput(input, filename) {
    if (filename && !filename.toLowerCase().endsWith('.xlsx')) {
        alert('Please select an Excel (.xlsx) file.');
        return;
    }

    let externalItems = null;

    if (browserExcelExportsEnabled()) {
        try {
            const module = await import('/static/browser-excel.js');
            const data = await module.importRaidExcelInBrowser(input);
            externalItems = data.items;
        } catch (error) {
            console.error('Browser RAID import failed, falling back to backend:', error);
        }
    }

    if (externalItems === null) {
        try {
            const formData = new FormData();
            const file = input instanceof File ? input : new File([input], filename || 'raid.xlsx', {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            });
            formData.append('file', file);

            const response = await fetch('/api/raid/import-excel', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || 'Import failed');
            }

            const data = await response.json();
            externalItems = data.items;
        } catch (error) {
            alert('Failed to import Excel: ' + error.message);
            return;
        }
    }

    if (externalItems.length === 0) {
        alert('No RAID items found in the Excel file.');
        return;
    }

    await openRaidSyncReview(externalItems, filename);
}

async function openRaidSyncReview(externalItems, filename) {
    const module = await import('/static/raid-sync.js');
    const projectId = (typeof getCurrentProjectId === 'function' && getCurrentProjectId()) || 'default';
    const syncState = module.getRaidSyncState(projectId);
    const baseItems = (syncState && syncState.items) || [];

    const entries = module.diffRaidSync(raidItems, externalItems, baseItems);

    raidSyncPendingEntries = entries;
    raidSyncPendingChoices = {};
    entries.forEach(entry => {
        raidSyncPendingChoices[entry.id] = module.defaultRaidSyncChoice(entry.kind);
    });
    raidSyncPendingFilename = filename;

    renderRaidSyncReview(entries);

    const overlay = document.getElementById('raidSyncOverlay');
    if (overlay) overlay.classList.add('active');
}

function renderRaidSyncReview(entries) {
    const summary = document.getElementById('raidSyncSummary');
    const emptyEl = document.getElementById('raidSyncEmpty');
    const listEl = document.getElementById('raidSyncList');
    const applyBtn = document.getElementById('raidSyncApplyBtn');
    if (!summary || !emptyEl || !listEl || !applyBtn) return;

    if (entries.length === 0) {
        summary.textContent = '';
        emptyEl.style.display = 'block';
        listEl.style.display = 'none';
        applyBtn.style.display = 'none';
        return;
    }

    emptyEl.style.display = 'none';
    listEl.style.display = 'flex';
    applyBtn.style.display = '';
    summary.textContent = entries.length + ' change' + (entries.length === 1 ? '' : 's') +
        ' found since the last sync. Review and choose what to apply.';

    const sideRow = (label, item) =>
        '<div class="raid-sync-entry-side"><div class="raid-sync-entry-side-label">' + escapeHtml(label) +
        '</div>' + escapeHtml(item.title || '(untitled)') + ' — ' + escapeHtml(item.status || '') + '</div>';

    listEl.innerHTML = '';
    entries.forEach(entry => {
        const row = document.createElement('div');
        row.className = 'raid-sync-entry raid-sync-kind-' + entry.kind;

        const item = entry.external || entry.local;
        const badge = '<span class="raid-sync-kind-badge raid-sync-kind-' + entry.kind + '">' + entry.kind + '</span>';

        let sidesHtml = '';
        let choiceHtml = '';
        const checked = raidSyncPendingChoices[entry.id];

        if (entry.kind === 'conflict') {
            sidesHtml = '<div class="raid-sync-entry-sides">' +
                sideRow('Your plan', entry.local) + sideRow('Excel file', entry.external) + '</div>';
            choiceHtml =
                '<label><input type="radio" name="raid-sync-choice-' + entry.id + '" value="keep-mine" ' +
                (checked === 'keep-mine' ? 'checked' : '') + ' onchange="setRaidSyncChoice(' + entry.id + ", 'keep-mine')\"> Keep mine</label>" +
                '<label><input type="radio" name="raid-sync-choice-' + entry.id + '" value="keep-theirs" ' +
                (checked === 'keep-theirs' ? 'checked' : '') + ' onchange="setRaidSyncChoice(' + entry.id + ", 'keep-theirs')\"> Keep Excel</label>";
        } else if (entry.kind === 'updated') {
            sidesHtml = '<div class="raid-sync-entry-sides">' +
                sideRow('Your plan', entry.local) + sideRow('Excel file', entry.external) + '</div>';
            choiceHtml = raidSyncCheckboxHtml(entry.id, checked === 'accept', 'Apply update');
        } else if (entry.kind === 'added') {
            choiceHtml = raidSyncCheckboxHtml(entry.id, checked === 'accept', 'Add to plan');
        } else if (entry.kind === 'removed') {
            choiceHtml = raidSyncCheckboxHtml(entry.id, checked === 'accept', 'Remove from plan');
        }

        row.innerHTML =
            '<div class="raid-sync-entry-body">' +
            '<div class="raid-sync-entry-title">' + badge + ' #' + entry.id + ' — ' + escapeHtml(item.title || '(untitled)') + '</div>' +
            '<div class="raid-sync-entry-detail">' + escapeHtml(item.type || '') + ' · ' + escapeHtml(item.status || '') + '</div>' +
            sidesHtml +
            '</div>' +
            '<div class="raid-sync-entry-choice">' + choiceHtml + '</div>';
        listEl.appendChild(row);
    });
}

function raidSyncCheckboxHtml(id, isChecked, label) {
    return '<label><input type="checkbox" ' + (isChecked ? 'checked' : '') +
        ' onchange="setRaidSyncChoice(' + id + ", this.checked ? 'accept' : 'reject')\"> " + escapeHtml(label) + '</label>';
}

function setRaidSyncChoice(id, choice) {
    raidSyncPendingChoices[id] = choice;
}

function closeRaidSyncReview() {
    const overlay = document.getElementById('raidSyncOverlay');
    if (overlay) overlay.classList.remove('active');
    raidSyncPendingEntries = [];
    raidSyncPendingChoices = {};
    raidSyncPendingFilename = '';
}

async function applyRaidSyncReview() {
    const module = await import('/static/raid-sync.js');
    const merged = module.applyRaidSyncDiff(raidItems, raidSyncPendingEntries, raidSyncPendingChoices);

    raidItems = merged;
    raidNextId = merged.length ? Math.max(...merged.map(i => i.id)) + 1 : 1;
    renderRaidTable();
    syncRaidLogToPlanText();

    const projectId = (typeof getCurrentProjectId === 'function' && getCurrentProjectId()) || 'default';
    const syncedAt = new Date();
    const syncedAtIso = syncedAt.toISOString();
    module.setRaidSyncState(projectId, {
        filename: raidSyncPendingFilename,
        items: merged,
        syncedAt: syncedAtIso
    });

    const editor = document.getElementById('planEditor');
    if (editor) {
        const pad = (n) => String(n).padStart(2, '0');
        const stamp = syncedAt.getFullYear() + '-' + pad(syncedAt.getMonth() + 1) + '-' + pad(syncedAt.getDate()) +
            ' ' + pad(syncedAt.getHours()) + ':' + pad(syncedAt.getMinutes());
        let text = editor.value;
        text = module.upsertFrontMatterField(text, 'excel_file', raidSyncPendingFilename);
        text = module.upsertFrontMatterField(text, 'excel_file_synced', stamp);
        setEditorValuePreservingCursor(editor, text);
        const kanbanEditor = document.getElementById('kanbanPlanEditor');
        if (kanbanEditor) kanbanEditor.value = text;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }

    showMessage('editor', 'success', 'RAID synced with Excel.');

    // Write-back (issue #761 step 4, extended by the sync-file-linking
    // follow-up): hand the merged state back out to the Excel file. When
    // this project's RAID target is linked to a real file on disk
    // (LocalFileAccess), write straight back through that handle — no
    // dialog, no download, matching the "press Sync and it updates both
    // files" report. Otherwise (Firefox/Safari, or no link yet) this falls
    // back to the original download-a-copy behaviour, unchanged.
    try {
        const excelModule = await import('/static/browser-excel.js');
        const filename = raidSyncPendingFilename || 'raid.xlsx';
        const linked = typeof LocalFileAccess !== 'undefined' &&
            LocalFileAccess.getLinkStatus(projectId, RAID_SYNC_TARGET_KEY) === 'linked';

        const result = await excelModule.exportRaidExcelInBrowser(merged, {
            projectName: 'RAID',
            filename: filename,
            download: !linked
        });

        if (linked) {
            const writeResult = await LocalFileAccess.writeLinkedFile(projectId, RAID_SYNC_TARGET_KEY, result.buffer);
            if (writeResult && writeResult.ok) {
                if (typeof showToast === 'function') {
                    showToast('Wrote changes back to ' + writeResult.filename + ' — no download needed.', 'success');
                }
            } else {
                // Don't strand the user's changes only in the plan: fall
                // back to a download so the workbook still gets updated
                // somehow, and explain why the one-click write didn't land.
                await excelModule.exportRaidExcelInBrowser(merged, { projectName: 'RAID', filename: filename });
                const reason = writeResult && writeResult.needsRelink
                    ? ' Re-link it in Settings > Sync to restore one-click sync.' : '';
                if (typeof showToast === 'function') {
                    showToast('Could not write back to the linked file — downloaded a copy instead.' + reason, 'error');
                }
            }
        }
    } catch (error) {
        console.error('RAID sync write-back export failed:', error);
    }

    closeRaidSyncReview();
}


/**
 * Interface Tour System
 */

function checkTasksWithoutExplicitDuration(planText, tasks) {
    const tasksWithoutDuration = [];

    // Parse the plan text to find which tasks have explicit durations
    const lines = planText.split('\n');
    const taskLinesWithDuration = new Set();

    for (let line of lines) {
        const trimmed = line.trim();

        // Skip empty lines, front matter, comments, headers
        if (!trimmed || trimmed.startsWith('---') || trimmed.startsWith('#')) continue;

        // Check if line has a duration pattern: Xd, Xw, Xm, Xy
        const durationMatch = trimmed.match(/\b(\d+[dwmy])\b/);
        if (durationMatch) {
            // Extract task name (before duration, resources, dates, etc.)
            // Task format: [indent]TaskName duration [resources] [dates] {comment}
            const taskNameMatch = trimmed.match(/^(\*?)(.+?)\s+\d+[dwmy]/);
            if (taskNameMatch) {
                const taskName = taskNameMatch[2].trim();
                taskLinesWithDuration.add(taskName);
            }
        }
    }

    // Filter tasks that don't have explicit duration in the plan text
    for (let task of tasks) {
        if (task.is_summary) continue; // Skip summary tasks

        // Check if this task name appears in our set of tasks with explicit durations
        if (!taskLinesWithDuration.has(task.name)) {
            tasksWithoutDuration.push(task);
        }
    }

    return tasksWithoutDuration;
}

/**
 * Update Analysis tab with project health checks and actionable insights
 */
function updateAnalysis(planText, tasks, frontMatter, resourceMap) {
    try {
        // Show analysis content, hide placeholder
        const placeholder = document.querySelector('#analysis-view .analysis-placeholder');
        const content = document.querySelector('#analysis-view .analysis-content');

        if (placeholder && content) {
            placeholder.style.display = 'none';
            content.style.display = 'block';
        }

        const insightsContainer = document.getElementById('analysisInsights');
        if (!insightsContainer) return;

        // Clear existing insights
        insightsContainer.innerHTML = '';

        const insights = [];
        const actions = [];

        // 1. Check for overdue tasks
        const overdueTasks = getOverdueTasks(tasks);
        if (overdueTasks.length > 0) {
            insights.push({
                type: 'warning',
                title: 'Overdue Tasks',
                description: overdueTasks.length + ' task(s) are past their finish date and not yet complete',
                items: overdueTasks.slice(0, 5).map(t => '"' + t.name + '" was due ' + t.finish),
                fixable: false
            });
            actions.push({
                text: 'Review ' + overdueTasks.length + ' overdue task(s) and update completion status or reschedule',
                severity: 'high'
            });
        }

        // 2. EVM insights
        const evmInsights = getEvmInsights();
        evmInsights.forEach(i => insights.push(i));
        const evmActions = getEvmActions();
        evmActions.forEach(a => actions.push(a));

        // 3. RAID log insights
        const raidInsights = getRaidInsights();
        raidInsights.forEach(i => insights.push(i));
        const raidActions = getRaidActions();
        raidActions.forEach(a => actions.push(a));

        // 4. Baseline comparison insights
        const baselineInsights = getBaselineInsights(tasks);
        baselineInsights.forEach(i => insights.push(i));

        // 5. Check for resource shortname capitalization issues
        const resourceIssues = checkResourceCapitalization(planText, resourceMap);
        if (resourceIssues.length > 0) {
            insights.push({
                type: 'warning',
                title: 'Resource Shortname Capitalization',
                description: 'Some resource shortnames are not capitalized consistently',
                items: resourceIssues,
                fixable: true,
                fixAction: () => fixResourceCapitalization(resourceIssues)
            });
        }

        // 6. Check for missing resource names in front matter
        const missingResources = checkMissingResourceNames(tasks, resourceMap);
        if (missingResources.length > 0) {
            insights.push({
                type: 'info',
                title: 'Missing Resource Definitions',
                description: 'Some resources used in tasks are not defined in the front matter',
                items: missingResources.map(r => 'Resource @' + r + ' is used but not defined'),
                fixable: true,
                fixAction: () => addMissingResources(missingResources)
            });
        }

        // 7. Check for missing stakeholders
        const frontMatterStr = typeof frontMatter === 'string' ? frontMatter : '';
        const hasStakeholders = frontMatterStr && frontMatterStr.toLowerCase().includes('stakeholders:');
        if (!hasStakeholders) {
            insights.push({
                type: 'suggestion',
                title: 'Missing Stakeholders',
                description: 'Consider adding key stakeholders to the project front matter',
                items: ['Add "Stakeholders:" section to track project stakeholders'],
                fixable: false
            });
        }

        // 8. Check for missing front matter fields
        const missingFields = checkMissingFrontMatterFields(frontMatter);
        if (missingFields.length > 0) {
            insights.push({
                type: 'suggestion',
                title: 'Missing Front Matter Fields',
                description: 'Some optional fields could improve project documentation',
                items: missingFields.map(f => 'Consider adding "' + f + '" to front matter'),
                fixable: false
            });
        }

        // 9. Check for tasks with missing durations (not explicitly set)
        const tasksWithoutExplicitDuration = checkTasksWithoutExplicitDuration(planText, tasks);
        if (tasksWithoutExplicitDuration.length > 0) {
            insights.push({
                type: 'warning',
                title: 'Tasks Without Duration',
                description: tasksWithoutExplicitDuration.length + ' task(s) have no duration specified',
                items: tasksWithoutExplicitDuration.slice(0, 5).map(t => 'Task "' + t.name + '" has no duration'),
                fixable: false
            });
        }

        // 10. Task completion summary
        const completionInsight = getTaskCompletionInsight(tasks);
        if (completionInsight) {
            insights.push(completionInsight);
        }

        // Project health summary (render first)
        const healthScore = calculateHealthScore(insights);
        renderHealthScore(insightsContainer, healthScore);

        // Render all insights
        insights.forEach(insight => renderInsight(insightsContainer, insight));

        // Show success message if no issues
        if (insights.length === 0) {
            insightsContainer.innerHTML += '<div class="analysis-success"><h3>✓ Project Looks Good!</h3><p>No issues found. Your project plan is well-structured.</p></div>';
        }

        // Render actions section
        renderAnalysisActions(actions);

        // Render Quality Analyser (ProjectQA) checks
        runQualityAnalyserChecks(tasks);

    } catch (error) {
        console.error('Error updating analysis:', error);
    }
}

/**
 * Get tasks that are overdue (past finish date, not 100% complete)
 */
function getOverdueTasks(tasks) {
    if (!tasks || tasks.length === 0) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return tasks.filter(t => {
        if (t.is_summary) return false;
        const pct = parseFloat(t.percent) || 0;
        if (pct >= 100) return false;
        if (!t.finish) return false;
        const finish = new Date(t.finish);
        return !isNaN(finish) && finish < today;
    });
}

/**
 * Get EVM-based insights from cached evmData
 */
function getEvmInsights() {
    if (!evmData) return [];
    const insights = [];

    // SPI insight
    if (evmData.SPI > 0) {
        const spi = evmData.SPI;
        if (spi < 0.8) {
            insights.push({
                type: 'warning',
                title: 'Schedule Performance (SPI: ' + spi.toFixed(2) + ')',
                description: 'Project is significantly behind schedule. Earned value is well below planned value.',
                items: [
                    'SPI = ' + spi.toFixed(2) + ' (target: 1.0)',
                    'Schedule Variance: ' + formatEvmCurrency(evmData.SV, evmData.hasBudgetData),
                    'Time elapsed: ' + Math.round(evmData.timeElapsedFraction * 100) + '%, Work complete: ' + Math.round(evmData.overallPercentComplete) + '%'
                ],
                fixable: false
            });
        } else if (spi < 1.0) {
            insights.push({
                type: 'info',
                title: 'Schedule Performance (SPI: ' + spi.toFixed(2) + ')',
                description: 'Project is slightly behind schedule.',
                items: [
                    'SPI = ' + spi.toFixed(2) + ' (target: 1.0)',
                    'Schedule Variance: ' + formatEvmCurrency(evmData.SV, evmData.hasBudgetData)
                ],
                fixable: false
            });
        } else if (spi > 1.1) {
            insights.push({
                type: 'suggestion',
                title: 'Schedule Performance (SPI: ' + spi.toFixed(2) + ')',
                description: 'Project is ahead of schedule.',
                items: ['SPI = ' + spi.toFixed(2) + ' — ahead of plan'],
                fixable: false
            });
        }
    }

    // CPI insight (only when budget data exists)
    if (evmData.hasBudgetData && evmData.CPI > 0) {
        const cpi = evmData.CPI;
        if (cpi < 0.8) {
            insights.push({
                type: 'warning',
                title: 'Cost Performance (CPI: ' + cpi.toFixed(2) + ')',
                description: 'Project is significantly over budget. Spending exceeds earned value.',
                items: [
                    'CPI = ' + cpi.toFixed(2) + ' (target: 1.0)',
                    'Cost Variance: ' + formatEvmCurrency(evmData.CV, true),
                    'Estimate at Completion: ' + formatEvmCurrency(evmData.EAC, true) + ' vs Budget: ' + formatEvmCurrency(evmData.BAC, true)
                ],
                fixable: false
            });
        } else if (cpi < 1.0) {
            insights.push({
                type: 'info',
                title: 'Cost Performance (CPI: ' + cpi.toFixed(2) + ')',
                description: 'Project is slightly over budget.',
                items: [
                    'CPI = ' + cpi.toFixed(2) + ' (target: 1.0)',
                    'Cost Variance: ' + formatEvmCurrency(evmData.CV, true)
                ],
                fixable: false
            });
        }
    }

    return insights;
}

/**
 * Format EVM currency/day values for display
 */
function formatEvmCurrency(value, hasBudgetData) {
    if (hasBudgetData) {
        return (value >= 0 ? '+' : '') + value.toFixed(0);
    }
    return (value >= 0 ? '+' : '') + value.toFixed(1) + ' days';
}

/**
 * Get suggested actions based on EVM data
 */
function getEvmActions() {
    if (!evmData) return [];
    const actions = [];

    if (evmData.SPI > 0 && evmData.SPI < 0.9) {
        actions.push({
            text: 'Schedule is behind (SPI ' + evmData.SPI.toFixed(2) + '). Consider adding resources, reducing scope, or extending the timeline.',
            severity: 'high'
        });
    }

    if (evmData.hasBudgetData && evmData.CPI > 0 && evmData.CPI < 0.9) {
        actions.push({
            text: 'Budget is overrunning (CPI ' + evmData.CPI.toFixed(2) + '). Review remaining work estimates and cost forecasts.',
            severity: 'high'
        });
    }

    if (evmData.VAC < 0 && evmData.hasBudgetData) {
        actions.push({
            text: 'Projected to exceed budget by ' + Math.abs(evmData.VAC).toFixed(0) + '. Reassess remaining scope or seek additional funding.',
            severity: 'medium'
        });
    }

    return actions;
}

/**
 * Get RAID log insights from the global raidItems array
 */
function getRaidInsights() {
    if (typeof raidItems === 'undefined' || raidItems.length === 0) return [];
    const insights = [];

    const openItems = raidItems.filter(i => i.status === 'open');
    const openRisks = openItems.filter(i => i.type === 'risk');
    const openIssues = openItems.filter(i => i.type === 'issue');

    // High-score open risks (score >= 16)
    const highRisks = openRisks.filter(r => (r.score || (r.impact * r.likelihood)) >= 16);
    if (highRisks.length > 0) {
        insights.push({
            type: 'warning',
            title: 'High-Priority Risks (' + highRisks.length + ')',
            description: highRisks.length + ' open risk(s) with a score of 16 or above require attention',
            items: highRisks.slice(0, 5).map(r => r.title + ' (score: ' + (r.score || r.impact * r.likelihood) + ')'),
            fixable: false
        });
    }

    // Open issues summary
    if (openIssues.length > 0) {
        insights.push({
            type: 'info',
            title: 'Open Issues (' + openIssues.length + ')',
            description: openIssues.length + ' issue(s) in the RAID log are still open',
            items: openIssues.slice(0, 5).map(i => i.title),
            fixable: false
        });
    }

    // Overall RAID summary
    if (openItems.length > 0) {
        const byType = {};
        openItems.forEach(item => {
            byType[item.type] = (byType[item.type] || 0) + 1;
        });
        const summaryItems = Object.keys(byType).map(t => t.charAt(0).toUpperCase() + t.slice(1) + 's: ' + byType[t]);
        insights.push({
            type: 'info',
            title: 'RAID Log Summary (' + openItems.length + ' open)',
            description: 'Breakdown of open RAID items by type',
            items: summaryItems,
            fixable: false
        });
    }

    return insights;
}

/**
 * Get suggested actions based on RAID data
 */
function getRaidActions() {
    if (typeof raidItems === 'undefined' || raidItems.length === 0) return [];
    const actions = [];

    const openItems = raidItems.filter(i => i.status === 'open');
    const highRisks = openItems.filter(i => i.type === 'risk' && (i.score || (i.impact * i.likelihood)) >= 16);
    const openIssues = openItems.filter(i => i.type === 'issue');

    if (highRisks.length > 0) {
        actions.push({
            text: 'Escalate ' + highRisks.length + ' high-priority risk(s). Ensure mitigation actions are assigned and tracked.',
            severity: 'high'
        });
    }

    if (openIssues.length > 3) {
        actions.push({
            text: 'Review ' + openIssues.length + ' open issues. Consider a triage session to prioritize and assign owners.',
            severity: 'medium'
        });
    }

    // Check for items without mitigation
    const noMitigation = openItems.filter(i => i.type === 'risk' && (!i.mitigation_actions || i.mitigation_actions.trim() === ''));
    if (noMitigation.length > 0) {
        actions.push({
            text: noMitigation.length + ' open risk(s) have no mitigation actions defined. Add mitigation plans to reduce exposure.',
            severity: 'medium'
        });
    }

    return actions;
}

/**
 * Get baseline comparison insights
 */
function getBaselineInsights(tasks) {
    if (typeof baselineItems === 'undefined' || baselineItems.length === 0) return [];
    if (!tasks || tasks.length === 0) return [];

    const insights = [];

    const currentNames = new Set(tasks.filter(t => !t.is_summary).map(t => t.name));
    const baselineNames = new Set(baselineItems.map(b => b.name));

    // Scope changes: tasks added since baseline
    const addedTasks = tasks.filter(t => !t.is_summary && !baselineNames.has(t.name));
    const removedTasks = baselineItems.filter(b => !currentNames.has(b.name));

    if (addedTasks.length > 0 || removedTasks.length > 0) {
        const items = [];
        if (addedTasks.length > 0) {
            items.push(addedTasks.length + ' task(s) added since baseline');
            addedTasks.slice(0, 3).forEach(t => items.push('  Added: "' + t.name + '"'));
        }
        if (removedTasks.length > 0) {
            items.push(removedTasks.length + ' task(s) removed since baseline');
            removedTasks.slice(0, 3).forEach(t => items.push('  Removed: "' + t.name + '"'));
        }
        insights.push({
            type: 'info',
            title: 'Scope Changes Since Baseline',
            description: 'The project scope has changed compared to the baseline',
            items: items,
            fixable: false
        });
    }

    // Schedule variance: tasks whose dates shifted
    const slippedTasks = [];
    tasks.filter(t => !t.is_summary && t.finish).forEach(t => {
        const baselineTask = baselineItems.find(b => b.name === t.name);
        if (!baselineTask || !baselineTask.finish) return;
        const currentFinish = new Date(t.finish);
        const baselineFinish = new Date(baselineTask.finish);
        if (isNaN(currentFinish) || isNaN(baselineFinish)) return;
        const diffDays = Math.round((currentFinish - baselineFinish) / (1000 * 60 * 60 * 24));
        if (diffDays > 0) {
            slippedTasks.push({ name: t.name, days: diffDays });
        }
    });

    if (slippedTasks.length > 0) {
        slippedTasks.sort((a, b) => b.days - a.days);
        insights.push({
            type: 'warning',
            title: 'Schedule Slippage (' + slippedTasks.length + ' tasks)',
            description: slippedTasks.length + ' task(s) have slipped from their baseline finish dates',
            items: slippedTasks.slice(0, 5).map(t => '"' + t.name + '" slipped by ' + t.days + ' day(s)'),
            fixable: false
        });
    }

    return insights;
}

/**
 * Get task completion summary insight
 */
function getTaskCompletionInsight(tasks) {
    if (!tasks || tasks.length === 0) return null;
    const workTasks = tasks.filter(t => !t.is_summary && t.duration_days > 0);
    if (workTasks.length === 0) return null;

    const completed = workTasks.filter(t => (parseFloat(t.percent) || 0) >= 100).length;
    const inProgress = workTasks.filter(t => {
        const pct = parseFloat(t.percent) || 0;
        return pct > 0 && pct < 100;
    }).length;
    const notStarted = workTasks.filter(t => (parseFloat(t.percent) || 0) === 0).length;

    return {
        type: 'info',
        title: 'Task Completion Summary',
        description: workTasks.length + ' work tasks in total',
        items: [
            'Completed: ' + completed + ' (' + Math.round(completed / workTasks.length * 100) + '%)',
            'In progress: ' + inProgress,
            'Not started: ' + notStarted
        ],
        fixable: false
    };
}

/**
 * Render suggested actions based on analysis insights
 */
function renderAnalysisActions(actions) {
    const container = document.getElementById('analysisActions');
    if (!container) return;
    container.innerHTML = '';

    if (actions.length === 0) return;

    const heading = document.createElement('h3');
    heading.className = 'analysis-actions-title';
    heading.textContent = 'Suggested Actions';
    container.appendChild(heading);

    const list = document.createElement('ul');
    list.className = 'analysis-actions-list';
    list.setAttribute('role', 'list');

    actions.forEach(action => {
        const li = document.createElement('li');
        li.className = 'analysis-action-item analysis-action-' + action.severity;
        li.innerHTML = '<span class="action-severity-badge action-badge-' + action.severity + '">' + action.severity + '</span> ' + action.text;
        list.appendChild(li);
    });

    container.appendChild(list);
}

function calculateHealthScore(insights) {
    const weights = {
        warning: -10,
        info: -5,
        suggestion: -2
    };

    let score = 100;
    insights.forEach(insight => {
        score += weights[insight.type] || 0;
    });

    return Math.max(0, Math.min(100, score));
}

function renderHealthScore(container, score) {
    let status, color;
    if (score >= 90) {
        status = 'Excellent';
        color = '#4caf50';
    } else if (score >= 70) {
        status = 'Good';
        color = '#8bc34a';
    } else if (score >= 50) {
        status = 'Fair';
        color = '#ff9800';
    } else {
        status = 'Needs Attention';
        color = '#f44336';
    }

    const healthDiv = document.createElement('div');
    healthDiv.className = 'analysis-health-score';
    healthDiv.innerHTML = '<h3>Project Health Score</h3><div class="health-score-value" style="color: ' + color + ';">' + score + '/100</div><div class="health-score-status" style="color: ' + color + ';">' + status + '</div>';
    container.appendChild(healthDiv);
}

function renderInsight(container, insight) {
    const insightDiv = document.createElement('div');
    insightDiv.className = 'analysis-insight analysis-' + insight.type;

    const icon = insight.type === 'warning' ? '⚠️' : insight.type === 'info' ? 'ℹ️' : '💡';

    let itemsHTML = '';
    if (insight.items && insight.items.length > 0) {
        itemsHTML = '<ul class="insight-items">';
        insight.items.forEach((item, idx) => {
            if (idx < 5) {
                itemsHTML += '<li>' + item + '</li>';
            }
        });
        if (insight.items.length > 5) {
            itemsHTML += '<li><em>...and ' + (insight.items.length - 5) + ' more</em></li>';
        }
        itemsHTML += '</ul>';
    }

    const fixButton = insight.fixable ? '<button class="fix-it-btn">Fix It</button>' : '';

    insightDiv.innerHTML = '<div class="insight-header"><span class="insight-icon">' + icon + '</span><h4>' + insight.title + '</h4></div><p class="insight-description">' + insight.description + '</p>' + itemsHTML + fixButton;

    if (insight.fixable && insight.fixAction) {
        const btn = insightDiv.querySelector('.fix-it-btn');
        if (btn) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                insight.fixAction();
                btn.textContent = '✓ Fixed';
                btn.disabled = true;
            });
        }
    }

    container.appendChild(insightDiv);
}

function checkResourceCapitalization(planText, resourceMap) {
    const issues = [];
    const lines = planText.split('\n');
    let inFrontMatter = false;
    let frontMatterSeen = false;
    let inExcludedSection = false;

    lines.forEach((line, idx) => {
        const trimmed = line.trim();

        // Track front matter boundaries (between --- delimiters)
        if (trimmed === '---') {
            if (!frontMatterSeen) {
                inFrontMatter = true;
                frontMatterSeen = true;
            } else if (inFrontMatter) {
                inFrontMatter = false;
            }
            return;
        }

        // Track excluded sections (highlights, RAID log, budget, baseline, whiteboard)
        if (trimmed === '---highlights---' || trimmed === '---raid log---' ||
            trimmed === '---budget---' || trimmed === '---baseline---' ||
            trimmed === '---whiteboard---') {
            inExcludedSection = true;
            return;
        }
        if (trimmed === '---end-highlights---') {
            inExcludedSection = false;
            return;
        }

        // Skip excluded sections - only check front matter and task lines
        if (inExcludedSection) return;
        // Skip comment lines and section headers outside front matter
        if (!inFrontMatter && (!trimmed || trimmed.startsWith('#') || trimmed.includes('==='))) return;

        // Use negative lookbehind to exclude email addresses (characters before @)
        const matches = line.match(/(?<!\w)@(\w+)/g);
        if (matches) {
            matches.forEach(match => {
                const shortname = match.replace(/^@/, '');
                if (shortname[0] === shortname[0].toLowerCase()) {
                    issues.push('Line ' + (idx + 1) + ': "' + match + '" should be capitalized (e.g., "@' + (shortname.charAt(0).toUpperCase() + shortname.slice(1)) + '")');
                }
            });
        }
    });

    return issues;
}

function checkMissingResourceNames(tasks, resourceMap) {
    const missing = new Set();

    tasks.forEach(task => {
        if (task.resources) {
            const resources = task.resources.split(',').map(r => r.trim().toLowerCase());
            resources.forEach(r => {
                if (r && r.startsWith('@')) {
                    const shortname = r.substring(1);
                    if (!resourceMap[shortname] && !resourceMap[shortname.toLowerCase()]) {
                        missing.add(shortname);
                    }
                }
            });
        }
    });

    return Array.from(missing);
}

function checkMissingFrontMatterFields(frontMatter) {
    const missing = [];
    const optionalFields = ['description', 'status', 'budget', 'sponsor', 'stakeholders'];

    // Convert to string if needed
    const frontMatterStr = typeof frontMatter === 'string' ? frontMatter : '';

    optionalFields.forEach(field => {
        if (!frontMatterStr || !frontMatterStr.toLowerCase().includes(field + ':')) {
            missing.push(field);
        }
    });

    return missing;
}

function fixResourceCapitalization(issues) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    let text = editor.value;

    issues.forEach(issue => {
        const match = issue.match(/@(\w+)/);
        if (match) {
            const lowercase = match[1];
            const capitalized = lowercase.charAt(0).toUpperCase() + lowercase.slice(1);
            // Use negative lookbehind to avoid replacing email addresses
            const regex = new RegExp('(?<!\\w)@' + lowercase + '\\b', 'g');
            text = text.replace(regex, '@' + capitalized);
        }
    });

    editor.value = text;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
}

function addMissingResources(missingResources) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const lines = editor.value.split('\n');
    let resourceSectionEnd = -1;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === 'Resources:') {
            for (let j = i + 1; j < lines.length; j++) {
                if (lines[j].startsWith('-') && lines[j].includes(':')) {
                    resourceSectionEnd = j;
                } else if (lines[j].trim() === '---' || (!lines[j].startsWith('-') && lines[j].trim() !== '')) {
                    break;
                }
            }
            break;
        }
    }

    if (resourceSectionEnd === -1) {
        const frontMatterEnd = lines.findIndex((line, idx) => idx > 0 && line.trim() === '---');
        if (frontMatterEnd > 0) {
            lines.splice(frontMatterEnd, 0, 'Resources:');
            resourceSectionEnd = frontMatterEnd;
        }
    }

    missingResources.forEach(shortname => {
        const capitalized = shortname.charAt(0).toUpperCase() + shortname.slice(1);
        const newLine = '- @' + capitalized + ': ' + capitalized + ', Role';
        lines.splice(resourceSectionEnd + 1, 0, newLine);
        resourceSectionEnd++;
    });

    editor.value = lines.join('\n');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
}

// ===== Quality Analyser (ProjectQA checks) =====

/**
 * Run all ProjectQA checks and render results into the qa-checks grid.
 *
 * @param {Array} tasks - Parsed task objects from the API.
 */
function runQualityAnalyserChecks(tasks) {
    const grid = document.getElementById('qaChecksGrid');
    if (!grid) return;

    grid.innerHTML = '';

    if (!tasks || tasks.length === 0) {
        grid.innerHTML = '<p class="qa-section-desc">No tasks available to analyse.</p>';
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const eightWeeksAhead = new Date(today);
    eightWeeksAhead.setDate(today.getDate() + 56);

    // Build successor map: taskName -> list of task names that depend on it
    const successorMap = buildSuccessorMap(tasks);

    // --- Information checks (just display counts) ---

    // Check 2: Count inbound dependencies (#inbound-labelled tasks or tasks with no predecessors that have successors)
    const inboundCount = countInboundDependencies(tasks);

    // Check 3: Count outbound dependencies (#outbound-labelled tasks)
    const outboundCount = countOutboundDependencies(tasks);

    // Check 4: Count remaining tasks (non-summary, not 100% complete)
    const remainingTasks = tasks.filter(t => !t.is_summary && (parseFloat(t.percent) || 0) < 100);
    const remainingCount = remainingTasks.length;

    // Check 5: Count key milestones (duration_days === 0, non-summary)
    const keyMilestones = tasks.filter(t => !t.is_summary && t.duration_days === 0);
    const keyMilestonesCount = keyMilestones.length;

    // Check 7: Count tasks finishing within next 8 weeks (non-summary, not complete)
    const finishingIn8Weeks = tasks.filter(t => {
        if (t.is_summary || (parseFloat(t.percent) || 0) >= 100) return false;
        if (!t.finish) return false;
        const finish = new Date(t.finish);
        return !isNaN(finish) && finish >= today && finish <= eightWeeksAhead;
    });
    const finishingIn8WeeksCount = finishingIn8Weeks.length;

    // --- Issue checks (flag as problems) ---

    // Check 6: Outbound milestones without predecessors
    const outboundMilestonesNoPreds = countOutboundMilestonesWithoutPredecessors(tasks);

    // Check 8: Tasks over 5 days long finishing within next 8 weeks
    const longTasksIn8Weeks = tasks.filter(t => {
        if (t.is_summary || (parseFloat(t.percent) || 0) >= 100) return false;
        if (!t.finish || !t.duration_days) return false;
        const finish = new Date(t.finish);
        return t.duration_days > 5 && !isNaN(finish) && finish >= today && finish <= eightWeeksAhead;
    });
    const longTasksIn8WeeksCount = longTasksIn8Weeks.length;

    // Check 9: Inbound milestones with no successors
    const inboundMilestonesNoSuccessors = countInboundMilestonesWithoutSuccessors(tasks, successorMap);

    // Check 10: Tasks over 20 days long (non-summary)
    const veryLongTasks = tasks.filter(t => !t.is_summary && t.duration_days > 20);
    const veryLongTasksCount = veryLongTasks.length;

    // Check 11: Tasks with no successors (non-summary, non-milestone, not complete)
    const tasksNoSuccessors = tasks.filter(t => {
        if (t.is_summary || (parseFloat(t.percent) || 0) >= 100) return false;
        const succs = successorMap[t.name] || [];
        return succs.length === 0;
    });
    const tasksNoSuccessorsCount = tasksNoSuccessors.length;

    // Check 12: Tasks with no predecessors (non-summary, not first task by position)
    const tasksNoPredecessors = tasks.filter(t => {
        if (t.is_summary) return false;
        const deps = t.depends || [];
        return deps.length === 0;
    });
    const tasksNoPredecessorsCount = tasksNoPredecessors.length;

    // Check 13: Tasks with negative float (overdue and not complete)
    const negativeFloatTasks = tasks.filter(t => {
        if (t.is_summary || (parseFloat(t.percent) || 0) >= 100) return false;
        if (!t.finish) return false;
        const finish = new Date(t.finish);
        return !isNaN(finish) && finish < today;
    });
    const negativeFloatCount = negativeFloatTasks.length;

    // Check 14: Tasks with work in the past (started but not complete, finish in past)
    const workInPast = tasks.filter(t => {
        if (t.is_summary || (parseFloat(t.percent) || 0) >= 100) return false;
        if (!t.start || !t.finish) return false;
        const start = new Date(t.start);
        const finish = new Date(t.finish);
        return !isNaN(start) && !isNaN(finish) && start < today && finish < today;
    });
    const workInPastCount = workInPast.length;

    // Check 15: Tasks with work complete in the future (100% but finish date is in the future)
    const workCompleteInFuture = tasks.filter(t => {
        if (t.is_summary) return false;
        const pct = parseFloat(t.percent) || 0;
        if (pct < 100) return false;
        if (!t.finish) return false;
        const finish = new Date(t.finish);
        return !isNaN(finish) && finish > today;
    });
    const workCompleteInFutureCount = workCompleteInFuture.length;

    // Render information checks
    const infoChecks = [
        { num: '2', label: 'Inbound dependencies', count: inboundCount },
        { num: '3', label: 'Outbound dependencies', count: outboundCount },
        { num: '4', label: 'Remaining tasks', count: remainingCount },
        { num: '5', label: 'Milestones', count: keyMilestonesCount },
        { num: '7', label: 'Tasks finishing in 8 weeks', count: finishingIn8WeeksCount },
    ];

    // Render issue checks
    const issueChecks = [
        { num: '6', label: 'Outbound milestones without predecessors', count: outboundMilestonesNoPreds },
        { num: '8', label: 'Tasks >5 days finishing in 8 weeks', count: longTasksIn8WeeksCount },
        { num: '9', label: 'Inbound milestones with no successors', count: inboundMilestonesNoSuccessors },
        { num: '10', label: 'Tasks over 20 days long', count: veryLongTasksCount },
        { num: '11', label: 'Tasks with no successors', count: tasksNoSuccessorsCount },
        { num: '12', label: 'Tasks with no predecessors', count: tasksNoPredecessorsCount },
        { num: '13', label: 'Tasks with negative float (overdue)', count: negativeFloatCount },
        { num: '14', label: 'Tasks with work in the past', count: workInPastCount },
        { num: '15', label: 'Tasks with work complete in future', count: workCompleteInFutureCount },
    ];

    infoChecks.forEach(check => {
        grid.appendChild(createQaCheckCard(check.num, check.count, check.label, 'info'));
    });

    issueChecks.forEach(check => {
        const cardType = check.count > 0 ? 'issue' : 'issue-ok';
        grid.appendChild(createQaCheckCard(check.num, check.count, check.label, cardType));
    });
}

/**
 * Build a map of task name -> array of task names that depend on it (successors).
 *
 * @param {Array} tasks
 * @returns {Object}
 */
function buildSuccessorMap(tasks) {
    const map = {};
    tasks.forEach(task => {
        if (!task.name) return;
        const deps = task.depends || [];
        deps.forEach(depName => {
            if (!map[depName]) map[depName] = [];
            map[depName].push(task.name);
        });
    });
    return map;
}

/**
 * Count inbound dependencies: tasks tagged #inbound or tasks representing
 * external inputs (no predecessors, but have successors - entry points).
 *
 * @param {Array} tasks
 * @returns {number}
 */
function countInboundDependencies(tasks) {
    return tasks.filter(t => {
        if (t.is_summary) return false;
        // Tagged explicitly as inbound
        const comment = (t.comment || '').toLowerCase();
        const name = (t.name || '').toLowerCase();
        return comment.includes('#inbound') || name.includes('#inbound');
    }).length;
}

/**
 * Count outbound dependencies: tasks tagged #outbound or milestones that
 * have no successors (potential hand-off points to other projects).
 *
 * @param {Array} tasks
 * @returns {number}
 */
function countOutboundDependencies(tasks) {
    return tasks.filter(t => {
        if (t.is_summary) return false;
        const comment = (t.comment || '').toLowerCase();
        const name = (t.name || '').toLowerCase();
        return comment.includes('#outbound') || name.includes('#outbound');
    }).length;
}

/**
 * Count outbound milestones (duration_days === 0) that have no predecessors.
 * These are milestones that kick off work but have no driving predecessors.
 *
 * @param {Array} tasks
 * @returns {number}
 */
function countOutboundMilestonesWithoutPredecessors(tasks) {
    return tasks.filter(t => {
        if (t.is_summary) return false;
        if (t.duration_days !== 0) return false;
        const deps = t.depends || [];
        return deps.length === 0;
    }).length;
}

/**
 * Count inbound milestones (duration_days === 0) that have no successors.
 * These milestones have nothing depending on them - potential orphans.
 *
 * @param {Array} tasks
 * @param {Object} successorMap
 * @returns {number}
 */
function countInboundMilestonesWithoutSuccessors(tasks, successorMap) {
    return tasks.filter(t => {
        if (t.is_summary) return false;
        if (t.duration_days !== 0) return false;
        const succs = successorMap[t.name] || [];
        return succs.length === 0;
    }).length;
}

/**
 * Create a QA check card DOM element.
 *
 * @param {string} checkNum - Check number (e.g., '2')
 * @param {number} count - The computed count value
 * @param {string} label - Human-readable check description
 * @param {'info'|'issue'|'issue-ok'} cardType - Card style
 * @returns {HTMLElement}
 */
function createQaCheckCard(checkNum, count, label, cardType) {
    const card = document.createElement('div');
    card.className = 'qa-check-card qa-' + cardType;
    card.setAttribute('role', 'article');
    card.setAttribute('aria-label', 'Check ' + checkNum + ': ' + label + ', count: ' + count);

    const numEl = document.createElement('div');
    numEl.className = 'qa-check-number';
    numEl.textContent = 'Check ' + checkNum;

    const countEl = document.createElement('div');
    countEl.className = 'qa-check-count';
    countEl.textContent = count;

    const labelEl = document.createElement('div');
    labelEl.className = 'qa-check-label';
    labelEl.textContent = label;

    const badgeEl = document.createElement('span');
    if (cardType === 'info') {
        badgeEl.className = 'qa-check-badge qa-badge-info';
        badgeEl.textContent = 'Info';
    } else if (cardType === 'issue') {
        badgeEl.className = 'qa-check-badge qa-badge-issue';
        badgeEl.textContent = 'Issue';
    } else {
        badgeEl.className = 'qa-check-badge qa-badge-ok';
        badgeEl.textContent = 'OK';
    }

    card.appendChild(numEl);
    card.appendChild(countEl);
    card.appendChild(labelEl);
    card.appendChild(badgeEl);

    return card;
}

// Toggle phases on timeline view
function toggleTimelinePhases() {
    // Re-render the timeline with current tasks
    if (timelineTasks && timelineTasks.length > 0) {
        updateTimeline(timelineTasks, timelineProjectName);
    }
    const toggle = document.getElementById('showPhasesToggle');
    if (toggle && typeof syncToolbarToSettings === 'function') syncToolbarToSettings('timeline_phases', toggle.checked);
}

// ===== MS Project Import =====

function triggerMSProjectUpload() {
    closeAllNavMenus();
    const input = document.getElementById('msProjectImportInput');
    input.value = '';
    input.onchange = function() {
        if (input.files && input.files[0]) {
            uploadMSProjectFile(input.files[0]);
        }
    };
    input.click();
}

// This target's key into LocalFileAccess's per-target handle map
// (local-file-access.js) -- distinct from the main plan file's default
// 'plan' target, and from RAID_SYNC_TARGET_KEY above.
const MSP_SYNC_TARGET_KEY = 'msproject';
const MSP_FILE_PICKER_OPTIONS = {
    id: 'noodleplanner-msproject',
    types: [{
        description: 'MS Project file',
        accept: {
            'application/vnd.ms-project': ['.mpp'],
            'application/xml': ['.xml'],
            'text/xml': ['.xml'],
        },
    }],
    excludeAcceptAllOption: false,
    multiple: false,
};

/**
 * Entry point for the Settings > Sync tab's "Sync Now" button on the MS
 * Project target -- mirrors syncRaidExcelTarget() above; see its comment
 * for the full reasoning on why the path taken depends purely on
 * LocalFileAccess's current link status, and why this must run with no
 * await before the first LocalFileAccess call.
 */
async function syncMSProjectTarget() {
    const projectId = (typeof getCurrentProjectId === 'function' && getCurrentProjectId()) || 'default';

    if (typeof LocalFileAccess === 'undefined' || !LocalFileAccess.isSupported()) {
        if (typeof showToast === 'function') {
            showToast('This browser can’t link Sync to a file on disk — choose the MS Project file each time instead.', 'info');
        }
        triggerMSProjectUpload();
        return;
    }

    await LocalFileAccess.ensureRestored(projectId);
    let status = LocalFileAccess.getLinkStatus(projectId, MSP_SYNC_TARGET_KEY);

    if (status === 'needs-relink') {
        const granted = await LocalFileAccess.requestWritePermission(projectId, MSP_SYNC_TARGET_KEY);
        status = granted ? 'linked' : 'unlinked';
    }

    if (status === 'linked') {
        let read = null;
        try {
            read = await LocalFileAccess.readLinkedFile(projectId, MSP_SYNC_TARGET_KEY, 'arraybuffer');
        } catch (error) {
            console.error('Could not read linked MS Project file:', error);
        }
        if (read) {
            await processMSProjectSyncInput(read.content, read.name);
            return;
        }
    }

    let picked;
    try {
        picked = await LocalFileAccess.pickAndLinkFile(projectId, MSP_SYNC_TARGET_KEY, MSP_FILE_PICKER_OPTIONS, 'arraybuffer');
    } catch (error) {
        showMessage('editor', 'error', 'Failed to open MS Project file: ' + error.message);
        return;
    }
    if (!picked) return; // user cancelled the picker

    await processMSProjectSyncInput(picked.content, picked.name);
}

/**
 * Shared by uploadMSProjectFile (a File, from the plain upload input) and
 * syncMSProjectTarget (raw bytes, from a linked handle). Native .mpp files
 * are parsed entirely in the browser (issue #770); MSPDI .xml still goes to
 * the server, same as before.
 */
async function processMSProjectSyncInput(bytesOrFile, filename) {
    if (/\.mpp$/i.test(filename || '')) {
        try {
            const { importMppBytes, parseResourceShortnames } = await import('/static/mpp-export.js');
            const bytes = bytesOrFile instanceof ArrayBuffer
                ? new Uint8Array(bytesOrFile)
                : new Uint8Array(await bytesOrFile.arrayBuffer());
            // Reuse the current plan's own resource shortcodes (@jd, not a
            // freshly re-derived @jdoe) where the full name matches -- a
            // .mpp file's resource table has no home for the shortcode
            // itself, so re-deriving one from scratch on every sync would
            // otherwise report a spurious diff on every task referencing
            // that resource, forever (#912).
            const editor = document.getElementById('planEditor');
            const preferredShortnames = parseResourceShortnames(editor ? editor.value : '');
            const markdown = importMppBytes(bytes, preferredShortnames);
            await applyImportedMspMarkdown(markdown, filename);
        } catch (error) {
            showMessage('editor', 'error', 'MS Project import failed: ' + error.message);
        }
        return;
    }

    const formData = new FormData();
    const file = bytesOrFile instanceof File ? bytesOrFile : new File([bytesOrFile], filename || 'schedule.xml', { type: 'application/xml' });
    formData.append('file', file);

    try {
        const response = await fetch('/api/msproject/import', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Failed to import MS Project file');
        }

        const result = await response.json();
        await applyImportedMspMarkdown(result.markdown, filename);
    } catch (error) {
        showMessage('editor', 'error', 'MS Project import failed: ' + error.message);
    }
}

// Applies a freshly-imported MS Project task tree to the editor. The import
// only ever contains a bare title + Resources front matter and a task
// tree -- it knows nothing about version, project manager, RAG,
// last_saved, custom fields, or any back-matter section (highlights,
// budget, benefits, RAID log, comms, lessons learned, baseline). A blind
// `editor.value = markdown` therefore silently destroys all of that, every
// time. This merges the import into the existing plan shell instead (see
// msproject-sync.js), and reviews the task tree itself as a per-task
// accept/reject/conflict-free diff (msproject-task-diff.js, issue #842)
// rather than replacing it wholesale -- tasks are matched by name and
// outline position, since plan markdown has no persistent task ID; a
// renamed or reparented task shows as removed + added rather than updated.
async function applyImportedMspMarkdown(markdown, filename) {
    const editor = document.getElementById('planEditor');
    const currentText = editor.value;

    if (!currentText.trim() || !/\S/.test(currentText.replace(/^---[\s\S]*?---/, ''))) {
        // Blank or task-less plan -- nothing to diff against, no need to review.
        await finishMspImport(markdown, filename);
        return;
    }

    await openMspSyncReview(currentText, markdown, filename);
}

async function finishMspImport(finalTextOrMarkdown, filename) {
    const module = await import('/static/msproject-sync.js');
    const editor = document.getElementById('planEditor');

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
        ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
    let finalText = module.upsertFrontMatterField(finalTextOrMarkdown, 'msproject_file', filename);
    finalText = module.upsertFrontMatterField(finalText, 'msproject_file_synced', stamp);

    editor.value = finalText;
    if (editor._updateLineNumbers) editor._updateLineNumbers();
    showMessage('editor', 'success', 'MS Project file imported successfully!');
    await renderText();

    // Write-back (issue #761's sync-file-linking follow-up): before this,
    // the MS Project sync flow only ever pulled the schedule INTO the plan
    // -- nothing produced updated .mpp bytes as part of a sync. When this
    // project's MS Project target is linked to a real .mpp file on disk,
    // build fresh bytes from the just-merged plan (mpp-export.js, the same
    // browser-side builder the Tools > Export > MS Project (.mpp) menu item
    // uses) and write them straight back through the handle -- no dialog,
    // no download. MSPDI .xml has no writer in this codebase (only a
    // reader, for the legacy server-side import path), so sync stays
    // import-only for that format; Settings > Sync says so explicitly.
    const projectId = (typeof getCurrentProjectId === 'function' && getCurrentProjectId()) || 'default';
    const mppLinked = typeof LocalFileAccess !== 'undefined' &&
        /\.mpp$/i.test(filename || '') &&
        LocalFileAccess.getLinkStatus(projectId, MSP_SYNC_TARGET_KEY) === 'linked';

    if (mppLinked) {
        try {
            const parse = await currentParseResult(finalText);
            const { exportMppInBrowser } = await import('/static/mpp-export.js');
            const { bytes } = await exportMppInBrowser(parse, parse.project_name || null, { download: function () {} });
            const writeResult = await LocalFileAccess.writeLinkedFile(projectId, MSP_SYNC_TARGET_KEY, bytes);
            if (writeResult && writeResult.ok) {
                if (typeof showToast === 'function') {
                    showToast('Wrote the schedule back to ' + writeResult.filename + ' — no download needed.', 'success');
                }
            } else {
                const reason = writeResult && writeResult.needsRelink
                    ? ' Re-link it in Settings > Sync to restore one-click sync.' : '';
                if (typeof showToast === 'function') {
                    showToast('Could not write the schedule back to the linked .mpp file.' + reason, 'error');
                }
            }
        } catch (error) {
            console.error('MS Project sync write-back failed:', error);
            if (typeof showToast === 'function') {
                showToast('Could not rebuild the .mpp file for write-back: ' + error.message, 'error');
            }
        }
    }
}

async function openMspSyncReview(currentText, importedMarkdown, filename) {
    const syncModule = await import('/static/msproject-sync.js');
    const diffModule = await import('/static/msproject-task-diff.js');

    const current = syncModule.splitFrontMatter(currentText);
    const imported = syncModule.splitFrontMatter(importedMarkdown);
    const localTaskBody = syncModule.stripBackMatterSections(current.rest);
    const importedTaskBody = syncModule.stripBackMatterSections(imported.rest);

    // A remembered last-synced snapshot (per project) upgrades this to a
    // real three-way diff -- able to tell a genuine conflict from a
    // one-sided change, and stop a deliberately-removed task being
    // resurrected. No snapshot (first-ever sync) falls back to a plain
    // two-way diff, same as before.
    const projectId = (typeof getCurrentProjectId === 'function' && getCurrentProjectId()) || 'default';
    const syncState = syncModule.getMspSyncState(projectId);
    const baseTaskBody = syncState ? syncState.taskBody : undefined;

    const diff = diffModule.diffTaskOutline(localTaskBody, importedTaskBody, baseTaskBody);

    if (diff.entries.length === 0) {
        // Task trees already match -- nothing to review, just record the
        // link and refresh front matter/back matter from the import.
        const mergedFrontMatterLines = syncModule.mergeFrontMatter(current.lines, imported.lines);
        const sections = syncModule.extractBackMatterSections(current.rest);
        const finalText = syncModule.assemblePlanText(mergedFrontMatterLines, localTaskBody, sections);
        syncModule.setMspSyncState(projectId, { taskBody: localTaskBody, syncedAt: new Date().toISOString() });
        await finishMspImport(finalText, filename);
        showMessage('editor', 'success', 'MS Project schedule already matches -- nothing to sync.');
        return;
    }

    mspSyncPendingCurrentText = currentText;
    mspSyncPendingImportedMarkdown = importedMarkdown;
    mspSyncPendingFilename = filename;
    mspSyncPendingDiff = diff;
    mspSyncPendingChoices = {};
    diff.entries.forEach((entry) => {
        mspSyncPendingChoices[entry.key] = diffModule.defaultTaskSyncChoice(entry.kind);
    });

    renderMspSyncReview(diff.entries);
    const overlay = document.getElementById('mspSyncOverlay');
    if (overlay) overlay.classList.add('active');
}

function renderMspSyncReview(entries) {
    const summary = document.getElementById('mspSyncSummary');
    const listEl = document.getElementById('mspSyncList');
    if (!summary || !listEl) return;

    summary.textContent = entries.length + ' task change' + (entries.length === 1 ? '' : 's') +
        ' found since the last sync. Review and choose what to apply. Renamed or moved tasks show as a removal plus an addition -- plan markdown has no persistent task ID to match on otherwise.';

    listEl.innerHTML = '';
    entries.forEach((entry, entryIndex) => {
        const row = document.createElement('div');
        row.className = 'msp-sync-entry msp-sync-kind-' + entry.kind;

        const badge = '<span class="msp-sync-kind-badge msp-sync-kind-' + entry.kind + '">' + entry.kind + '</span>';
        const displayName = (entry.local || entry.imported).name;
        const checked = mspSyncPendingChoices[entry.key];

        let detail = '';
        let sidesHtml = '';
        let choiceHtml = '';

        if (entry.kind === 'conflict') {
            sidesHtml = '<div class="msp-sync-entry-sides">' +
                '<div class="msp-sync-entry-side"><div class="msp-sync-entry-side-label">Your plan</div>' + escapeHtml(entry.local.raw.trim()) + '</div>' +
                '<div class="msp-sync-entry-side"><div class="msp-sync-entry-side-label">MS Project</div>' + escapeHtml(entry.imported.raw.trim()) + '</div>' +
                '</div>';
            choiceHtml = '<label><input type="radio" name="msp-sync-choice-conflict-' + entryIndex + '"' + (checked === 'keep-mine' ? ' checked' : '') + '> Keep mine</label>' +
                '<label><input type="radio" name="msp-sync-choice-conflict-' + entryIndex + '"' + (checked === 'keep-theirs' ? ' checked' : '') + '> Keep MS Project</label>';
        } else if (entry.kind === 'removed') {
            detail = entry.descendantCount > 0
                ? 'Also removes ' + entry.descendantCount + ' sub-task' + (entry.descendantCount === 1 ? '' : 's')
                : '';
            choiceHtml = '<label><input type="checkbox"' + (checked === 'accept' ? ' checked' : '') + '> Remove</label>';
        } else if (entry.kind === 'updated') {
            sidesHtml = '<div class="msp-sync-entry-sides">' +
                '<div class="msp-sync-entry-side"><div class="msp-sync-entry-side-label">Your plan</div>' + escapeHtml(entry.local.raw.trim()) + '</div>' +
                '<div class="msp-sync-entry-side"><div class="msp-sync-entry-side-label">MS Project</div>' + escapeHtml(entry.imported.raw.trim()) + '</div>' +
                '</div>';
            choiceHtml = '<label><input type="checkbox"' + (checked === 'accept' ? ' checked' : '') + '> Apply update</label>';
        } else if (entry.kind === 'added') {
            choiceHtml = '<label><input type="checkbox"' + (checked === 'accept' ? ' checked' : '') + '> Add to plan</label>';
        }

        row.innerHTML =
            '<div class="msp-sync-entry-body">' +
            '<div class="msp-sync-entry-title">' + badge + ' ' + escapeHtml(displayName) + '</div>' +
            (detail ? '<div class="msp-sync-entry-detail">' + escapeHtml(detail) + '</div>' : '') +
            sidesHtml +
            '</div>' +
            '<div class="msp-sync-entry-choice">' + choiceHtml + '</div>';

        // Task keys can contain arbitrary characters from task names --
        // wired via addEventListener with the key held in a closure rather
        // than string-interpolated into an inline handler, so nothing in a
        // task name can break out of the generated markup.
        if (entry.kind === 'conflict') {
            const [keepMine, keepTheirs] = row.querySelectorAll('input[type="radio"]');
            keepMine.addEventListener('change', () => { if (keepMine.checked) setMspSyncChoice(entry.key, 'keep-mine'); });
            keepTheirs.addEventListener('change', () => { if (keepTheirs.checked) setMspSyncChoice(entry.key, 'keep-theirs'); });
        } else {
            const checkbox = row.querySelector('input[type="checkbox"]');
            checkbox.addEventListener('change', () => setMspSyncChoice(entry.key, checkbox.checked ? 'accept' : 'reject'));
        }

        listEl.appendChild(row);
    });
}

function setMspSyncChoice(key, choice) {
    mspSyncPendingChoices[key] = choice;
}

function closeMspSyncReview() {
    const overlay = document.getElementById('mspSyncOverlay');
    if (overlay) overlay.classList.remove('active');
    mspSyncPendingCurrentText = '';
    mspSyncPendingImportedMarkdown = '';
    mspSyncPendingFilename = '';
    mspSyncPendingDiff = null;
    mspSyncPendingChoices = {};
    showMessage('editor', 'info', 'MS Project sync cancelled.');
}

async function applyMspSyncReview() {
    const syncModule = await import('/static/msproject-sync.js');
    const diffModule = await import('/static/msproject-task-diff.js');

    const current = syncModule.splitFrontMatter(mspSyncPendingCurrentText);
    const imported = syncModule.splitFrontMatter(mspSyncPendingImportedMarkdown);
    const localTaskBody = syncModule.stripBackMatterSections(current.rest);

    const newTaskBody = diffModule.applyTaskDiff(localTaskBody, mspSyncPendingDiff, mspSyncPendingChoices);
    const mergedFrontMatterLines = syncModule.mergeFrontMatter(current.lines, imported.lines);
    const sections = syncModule.extractBackMatterSections(current.rest);
    const finalText = syncModule.assemblePlanText(mergedFrontMatterLines, newTaskBody, sections);

    const projectId = (typeof getCurrentProjectId === 'function' && getCurrentProjectId()) || 'default';
    syncModule.setMspSyncState(projectId, { taskBody: newTaskBody, syncedAt: new Date().toISOString() });

    const filename = mspSyncPendingFilename;
    closeMspSyncReviewSilently();
    await finishMspImport(finalText, filename);
}

function closeMspSyncReviewSilently() {
    const overlay = document.getElementById('mspSyncOverlay');
    if (overlay) overlay.classList.remove('active');
    mspSyncPendingCurrentText = '';
    mspSyncPendingImportedMarkdown = '';
    mspSyncPendingFilename = '';
    mspSyncPendingDiff = null;
    mspSyncPendingChoices = {};
}

// Native .mpp files are read in the browser with mppwriter; nothing is
// uploaded (issue #770). Only MSPDI .xml still goes to the server. Delegates
// to processMSProjectSyncInput, shared with the linked-handle sync path
// (syncMSProjectTarget above).
async function uploadMSProjectFile(file) {
    await processMSProjectSyncInput(file, file.name);
}

// ===== Excel Import Wizard =====

function triggerExcelUpload() {
    closeAllNavMenus();
    const input = document.getElementById('excelImportInput');
    input.value = '';
    input.onchange = function() {
        if (input.files && input.files[0]) {
            openExcelImportWizard(input.files[0]);
        }
    };
    input.click();
}

// Excel wizard state is now in state.js

async function openExcelImportWizard(file) {
    excelWizardFile = file;
    excelWizardStep = 1;
    updateWizardStepUI();

    document.getElementById('wizardSheetSelect').innerHTML = '<option value="">-- Select a worksheet --</option>';
    document.getElementById('wizardSheetPreview').style.display = 'none';
    document.getElementById('wizardNextBtn').disabled = true;
    document.getElementById('wizardSpinner').style.display = 'block';

    const overlay = document.getElementById('excelWizardOverlay');
    overlay.classList.add('active');

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/api/excel/analyze', { method: 'POST', body: formData });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Failed to analyze file');
        }
        excelWizardData = await response.json();

        const select = document.getElementById('wizardSheetSelect');
        excelWizardData.sheets.forEach(sheet => {
            const opt = document.createElement('option');
            opt.value = sheet.name;
            opt.textContent = sheet.name + ' (' + sheet.row_count + ' rows)';
            select.appendChild(opt);
        });

        // Auto-select if only one sheet
        if (excelWizardData.sheets.length === 1) {
            select.value = excelWizardData.sheets[0].name;
            onWorksheetSelected();
        }
    } catch (e) {
        showMessage('upload', 'error', 'Excel analysis failed: ' + e.message);
        closeExcelWizard();
    } finally {
        document.getElementById('wizardSpinner').style.display = 'none';
    }
}

function closeExcelWizard() {
    document.getElementById('excelWizardOverlay').classList.remove('active');
    excelWizardFile = null;
    excelWizardData = null;
}

function onWorksheetSelected() {
    const sheetName = document.getElementById('wizardSheetSelect').value;
    const previewDiv = document.getElementById('wizardSheetPreview');
    const nextBtn = document.getElementById('wizardNextBtn');

    if (!sheetName || !excelWizardData) {
        previewDiv.style.display = 'none';
        nextBtn.disabled = true;
        return;
    }

    const sheet = excelWizardData.sheets.find(s => s.name === sheetName);
    if (!sheet) return;

    // Build preview table
    const table = document.getElementById('wizardPreviewTable');
    let html = '<thead><tr>';
    sheet.columns.forEach(col => { html += '<th>' + escapeHtml(col) + '</th>'; });
    html += '</tr></thead><tbody>';
    sheet.sample_rows.forEach(row => {
        html += '<tr>';
        row.forEach(cell => { html += '<td>' + escapeHtml(cell) + '</td>'; });
        html += '</tr>';
    });
    html += '</tbody>';
    table.innerHTML = html;

    previewDiv.style.display = 'block';
    nextBtn.disabled = false;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function buildMappingGrid(columns) {
    const grid = document.getElementById('wizardMappingGrid');
    const fields = [
        { key: 'task_name', label: 'Task Name', required: true },
        { key: 'start_date', label: 'Start Date' },
        { key: 'end_date', label: 'End Date' },
        { key: 'duration', label: 'Duration' },
        { key: 'resources', label: 'Resources' },
        { key: 'percent_complete', label: '% Complete' },
        { key: 'priority', label: 'Priority' },
        { key: 'bucket', label: 'Bucket' },
        { key: 'comment', label: 'Comment' },
        { key: 'depends_on', label: 'Dependencies' },
    ];

    // Auto-detection patterns
    const patterns = {
        task_name: ['task name', 'task', 'name', 'activity', 'wbs'],
        start_date: ['start', 'start date', 'begin', 'begin date'],
        end_date: ['finish', 'finish date', 'end', 'end date'],
        duration: ['duration', 'duration (days)', 'days', 'effort'],
        resources: ['resources', 'resource', 'assigned to', 'owner'],
        percent_complete: ['% complete', 'percent complete', 'complete', 'progress', '% done'],
        priority: ['priority', 'urgency', 'importance'],
        bucket: ['bucket', 'category', 'group', 'board column'],
        comment: ['comment', 'comments', 'notes', 'note', 'description'],
        depends_on: ['predecessors', 'depends on', 'dependencies', 'depends'],
    };

    let html = '';
    fields.forEach(field => {
        const autoMatch = autoDetectColumn(columns, patterns[field.key] || []);
        html += '<div class="wizard-mapping-row">';
        html += '<label>' + field.label + (field.required ? ' *' : '') + '</label>';
        html += '<select id="wizardMap_' + field.key + '" class="form-control">';
        html += '<option value="">-- Not mapped --</option>';
        columns.forEach(col => {
            const selected = (col === autoMatch) ? ' selected' : '';
            html += '<option value="' + escapeHtml(col) + '"' + selected + '>' + escapeHtml(col) + '</option>';
        });
        html += '</select>';
        html += '</div>';
    });

    grid.innerHTML = html;
}

function autoDetectColumn(columns, patterns) {
    const colsLower = columns.map(c => c.toLowerCase().trim());
    for (const pattern of patterns) {
        const idx = colsLower.indexOf(pattern);
        if (idx >= 0) return columns[idx];
    }
    return '';
}

// Update 2-Week Look-Ahead View
function updateLookAhead(tasks) {
    try {
        // Show content, hide placeholder
        const placeholder = document.querySelector('#lookahead-view .lookahead-placeholder');
        const content = document.querySelector('#lookahead-view .lookahead-content');

        if (placeholder && content) {
            placeholder.style.display = 'none';
            content.style.display = 'block';
        }

        // Calculate date range (today + 14 days)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const twoWeeksFromNow = new Date(today);
        twoWeeksFromNow.setDate(today.getDate() + 14);

        // Update date range display
        const dateRangeEl = document.getElementById('lookaheadDateRange');
        if (dateRangeEl) {
            const formatDate = (date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            dateRangeEl.textContent = `Showing tasks from ${formatDate(today)} to ${formatDate(twoWeeksFromNow)}`;
        }

        // Expand recurring tasks into individual occurrences within the window
        const allTasksWithRecurring = [...tasks];
        tasks.forEach(task => {
            if (task.recurrence && !task.is_summary) {
                const occurrences = generateRecurrenceOccurrences(task, today, twoWeeksFromNow);
                occurrences.forEach(occ => allTasksWithRecurring.push(occ));
            }
        });

        // Filter overdue tasks (past due date, not complete) - skip pure recurring tasks (no fixed date)
        const overdueTasks = allTasksWithRecurring.filter(task => {
            if (task.is_summary || !task.finish) return false;
            if (task.is_recurring_instance) return false; // recurring instances don't go overdue
            const finishDate = new Date(task.finish);
            finishDate.setHours(0, 0, 0, 0);
            const percentComplete = parseInt(task.percent) || 0;
            return finishDate < today && percentComplete < 100;
        });

        // Filter upcoming tasks (start or finish within next 2 weeks, not summary)
        const upcomingTasks = allTasksWithRecurring.filter(task => {
            if (task.is_summary) return false;

            // For recurring instances, use the recurrence_date
            if (task.is_recurring_instance) {
                const occDate = new Date(task.recurrence_date + 'T00:00:00');
                return occDate >= today && occDate <= twoWeeksFromNow;
            }

            const startDate = task.start ? new Date(task.start) : null;
            const finishDate = task.finish ? new Date(task.finish) : null;

            if (startDate) startDate.setHours(0, 0, 0, 0);
            if (finishDate) finishDate.setHours(0, 0, 0, 0);

            // Check if task starts or finishes within the 2-week window
            const startsInWindow = startDate && startDate >= today && startDate <= twoWeeksFromNow;
            const finishesInWindow = finishDate && finishDate >= today && finishDate <= twoWeeksFromNow;

            return startsInWindow || finishesInWindow;
        });

        // Sort by finish date
        overdueTasks.sort((a, b) => new Date(a.finish) - new Date(b.finish));
        upcomingTasks.sort((a, b) => {
            const dateA = a.is_recurring_instance ? new Date(a.recurrence_date) : new Date(a.start || a.finish);
            const dateB = b.is_recurring_instance ? new Date(b.recurrence_date) : new Date(b.start || b.finish);
            return dateA - dateB;
        });

        // Populate overdue tasks table
        const overdueSection = document.getElementById('overdueSection');
        const overdueBody = document.getElementById('overdueTableBody');
        if (overdueBody && overdueSection) {
            overdueBody.innerHTML = '';
            if (overdueTasks.length > 0) {
                overdueSection.style.display = 'block';
                overdueTasks.forEach(task => {
                    const row = createLookAheadRow(task, 'overdue', today);
                    overdueBody.appendChild(row);
                });
            } else {
                overdueSection.style.display = 'none';
            }
        }

        // Populate upcoming tasks table
        const upcomingSection = document.getElementById('upcomingSection');
        const upcomingBody = document.getElementById('upcomingTableBody');
        if (upcomingBody && upcomingSection) {
            upcomingBody.innerHTML = '';
            if (upcomingTasks.length > 0) {
                upcomingSection.style.display = 'block';
                upcomingTasks.forEach(task => {
                    const row = createLookAheadRow(task, 'upcoming');
                    upcomingBody.appendChild(row);
                });
            } else {
                upcomingSection.style.display = 'none';
            }
        }

        // Show empty state if no tasks
        const emptyState = document.getElementById('lookaheadEmpty');
        if (emptyState) {
            emptyState.style.display = (overdueTasks.length === 0 && upcomingTasks.length === 0) ? 'block' : 'none';
        }

    } catch (error) {
        console.error('Error updating look-ahead view:', error);
    }
}

// Helper function to create a row for look-ahead table
function createLookAheadRow(task, type, today) {
    const row = document.createElement('tr');
    row.style.cursor = 'pointer';
    row.onclick = () => openMilestoneTaskForm(task.name);

    // Task name with indentation and optional recurrence badge
    const nameCell = document.createElement('td');
    const indent = '  '.repeat(task.level || 0);
    nameCell.style.fontFamily = 'monospace';
    nameCell.classList.add('task-level-' + (task.level || 0));
    const nameText = document.createTextNode(indent + task.name);
    nameCell.appendChild(nameText);
    if (task.recurrence) {
        const badge = document.createElement('span');
        badge.className = 'recurrence-badge';
        badge.textContent = formatRecurrenceLabel(task.recurrence);
        badge.setAttribute('aria-label', 'Recurring: ' + formatRecurrenceLabel(task.recurrence));
        nameCell.appendChild(badge);
    }
    row.appendChild(nameCell);

    // For recurring instances, use recurrence_date as both start and finish
    const displayStart = task.is_recurring_instance ? task.recurrence_date : task.start;
    const displayFinish = task.is_recurring_instance ? task.recurrence_date : task.finish;

    if (type === 'overdue') {
        // Due date
        const dueDateCell = document.createElement('td');
        dueDateCell.textContent = displayFinish ? new Date(displayFinish + 'T00:00:00').toLocaleDateString() : '-';
        row.appendChild(dueDateCell);

        // Days late
        const daysLateCell = document.createElement('td');
        if (displayFinish && today) {
            const finishDate = new Date(displayFinish + 'T00:00:00');
            finishDate.setHours(0, 0, 0, 0);
            const diffTime = today - finishDate;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            daysLateCell.textContent = diffDays;
            daysLateCell.style.color = '#d32f2f';
            daysLateCell.style.fontWeight = 'bold';
        } else {
            daysLateCell.textContent = '-';
        }
        row.appendChild(daysLateCell);
    } else {
        // Start date
        const startCell = document.createElement('td');
        startCell.textContent = displayStart ? new Date(displayStart + 'T00:00:00').toLocaleDateString() : '-';
        row.appendChild(startCell);

        // Due date
        const dueDateCell = document.createElement('td');
        dueDateCell.textContent = displayFinish ? new Date(displayFinish + 'T00:00:00').toLocaleDateString() : '-';
        row.appendChild(dueDateCell);

        // Duration
        const durationCell = document.createElement('td');
        durationCell.textContent = task.is_recurring_instance ? 'recurring' : (task.duration_days ? `${task.duration_days}d` : '-');
        row.appendChild(durationCell);
    }

    // Resources
    const resourcesCell = document.createElement('td');
    resourcesCell.textContent = task.resources || '-';
    row.appendChild(resourcesCell);

    // Percent complete
    const percentCell = document.createElement('td');
    percentCell.textContent = task.percent !== undefined && task.percent !== null ? `${task.percent}%` : '0%';
    row.appendChild(percentCell);

    // RAG status
    const ragCell = document.createElement('td');
    ragCell.textContent = task.rag || '-';
    ragCell.style.backgroundColor = getRAGColor(task.rag);
    ragCell.style.color = '#fff';
    ragCell.style.fontWeight = 'bold';
    ragCell.style.textAlign = 'center';
    ragCell.style.borderRadius = '4px';
    row.appendChild(ragCell);

    return row;
}

// ============================================================
// Calendar View
// ============================================================

// Calendar state is now in state.js

function updateCalendar(tasks) {
    calendarTasks = (tasks || []).filter(t => !t.is_summary && t.start && t.finish);

    const placeholder = document.querySelector('#calendar-view .calendar-placeholder');
    const content = document.querySelector('#calendar-view .calendar-content');
    if (placeholder && content) {
        placeholder.style.display = 'none';
        content.style.display = 'flex';
    }

    renderCalendarMonth(calendarCurrentYear, calendarCurrentMonth);
}

function navigateCalendar(direction) {
    calendarCurrentMonth += direction;
    if (calendarCurrentMonth > 11) {
        calendarCurrentMonth = 0;
        calendarCurrentYear++;
    } else if (calendarCurrentMonth < 0) {
        calendarCurrentMonth = 11;
        calendarCurrentYear--;
    }
    renderCalendarMonth(calendarCurrentYear, calendarCurrentMonth, direction > 0 ? 'slide-left' : 'slide-right');
}

function navigateCalendarToday() {
    const today = new Date();
    const newMonth = today.getMonth();
    const newYear = today.getFullYear();

    if (newMonth === calendarCurrentMonth && newYear === calendarCurrentYear) return;

    const direction = (newYear * 12 + newMonth) > (calendarCurrentYear * 12 + calendarCurrentMonth)
        ? 'slide-left' : 'slide-right';

    calendarCurrentMonth = newMonth;
    calendarCurrentYear = newYear;
    renderCalendarMonth(calendarCurrentYear, calendarCurrentMonth, direction);
}

function renderCalendarMonth(year, month, animation) {
    const wrapper = document.getElementById('calendarGridWrapper');
    const title = document.getElementById('calendarTitle');
    if (!wrapper || !title) return;

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const ribbonSpan = title.querySelector('.ribbon-banner');
    if (ribbonSpan) {
        ribbonSpan.textContent = `${monthNames[month]} ${year}`;
    } else {
        title.textContent = `${monthNames[month]} ${year}`;
    }

    const newGrid = buildCalendarGrid(year, month);
    newGrid.id = 'calendarGrid';

    // Remove all existing calendar grids from the wrapper to prevent duplicates
    const existingGrids = wrapper.querySelectorAll('.calendar-grid');
    existingGrids.forEach(g => g.remove());

    wrapper.appendChild(newGrid);
}

function buildCalendarGrid(year, month) {
    const grid = document.createElement('div');
    grid.className = 'calendar-grid';

    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    dayNames.forEach(d => {
        const header = document.createElement('div');
        header.className = 'calendar-day-header';
        header.textContent = d;
        grid.appendChild(header);
    });

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const totalDays = lastDay.getDate();

    let startDow = firstDay.getDay();
    startDow = startDow === 0 ? 6 : startDow - 1;

    const prevMonthLast = new Date(year, month, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = startDow - 1; i >= 0; i--) {
        const dayNum = prevMonthLast - i;
        const cell = createCalendarDayCell(year, month - 1, dayNum, true);
        grid.appendChild(cell);
    }

    for (let d = 1; d <= totalDays; d++) {
        const cellDate = new Date(year, month, d);
        const isToday = cellDate.getTime() === today.getTime();
        const cell = createCalendarDayCell(year, month, d, false, isToday);
        grid.appendChild(cell);
    }

    const cellsRendered = startDow + totalDays;
    const remainingCells = (Math.ceil(cellsRendered / 7) * 7) - cellsRendered;
    for (let d = 1; d <= remainingCells; d++) {
        const cell = createCalendarDayCell(year, month + 1, d, true);
        grid.appendChild(cell);
    }

    // Set grid rows: auto for header row, 1fr for each week row to fill height
    const weekRows = Math.ceil(cellsRendered / 7);
    grid.style.gridTemplateRows = `auto repeat(${weekRows}, 1fr)`;

    return grid;
}

function createCalendarDayCell(year, month, day, isOtherMonth, isToday) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day-cell';
    if (isOtherMonth) cell.classList.add('calendar-other-month');
    if (isToday) cell.classList.add('calendar-today');

    const dayNumber = document.createElement('div');
    dayNumber.className = 'calendar-day-number';
    dayNumber.textContent = day;
    cell.appendChild(dayNumber);

    const dateStr = formatCalendarDate(year, month, day);
    const tasksForDay = getTasksForDate(dateStr);

    const taskList = document.createElement('div');
    taskList.className = 'calendar-task-list';

    const maxVisible = 4;
    const visibleTasks = tasksForDay.slice(0, maxVisible);
    const hiddenTasks = tasksForDay.slice(maxVisible);

    visibleTasks.forEach(task => {
        taskList.appendChild(createCalendarTaskItem(task));
    });

    if (hiddenTasks.length > 0) {
        const hiddenContainer = document.createElement('div');
        hiddenContainer.className = 'calendar-hidden-tasks';
        hiddenContainer.style.display = 'none';
        hiddenTasks.forEach(task => {
            hiddenContainer.appendChild(createCalendarTaskItem(task));
        });
        taskList.appendChild(hiddenContainer);

        const moreBtn = document.createElement('button');
        moreBtn.className = 'calendar-more-btn';
        moreBtn.textContent = `+${hiddenTasks.length} more`;
        moreBtn.onclick = function(e) {
            e.stopPropagation();
            const isExpanded = hiddenContainer.style.display !== 'none';
            hiddenContainer.style.display = isExpanded ? 'none' : 'block';
            moreBtn.textContent = isExpanded ? `+${hiddenTasks.length} more` : 'less';
        };
        taskList.appendChild(moreBtn);
    }

    cell.appendChild(taskList);

    if (!isOtherMonth) {
        const addBtn = document.createElement('button');
        addBtn.className = 'calendar-add-btn';
        addBtn.textContent = '+';
        addBtn.title = 'Add a new task on this date';
        addBtn.onclick = function(e) {
            e.stopPropagation();
            addCalendarTask(dateStr);
        };
        cell.appendChild(addBtn);
    }

    return cell;
}

function createCalendarTaskItem(task) {
    const item = document.createElement('div');
    item.className = 'calendar-task-item';

    const isComplete = (parseFloat(task.percent) || 0) >= 100;
    if (isComplete) {
        item.classList.add('calendar-task-complete');
    }

    const nameSpan = document.createElement('span');
    nameSpan.className = 'calendar-task-name';
    nameSpan.textContent = task.name;
    nameSpan.title = task.name;
    nameSpan.onclick = function(e) {
        e.stopPropagation();
        openMilestoneTaskForm(task.name);
    };

    if (isComplete) {
        const tick = document.createElement('span');
        tick.className = 'calendar-task-tick';
        tick.textContent = '\u2713';
        item.appendChild(tick);
    }

    item.appendChild(nameSpan);
    return item;
}

function getTasksForDate(dateStr) {
    const targetDate = parseLocalDate(dateStr);
    if (!targetDate) return [];

    return calendarTasks.filter(task => {
        const start = parseLocalDate(task.start);
        const finish = parseLocalDate(task.finish);
        if (!start || !finish) return false;
        return targetDate >= start && targetDate <= finish;
    });
}

function formatCalendarDate(year, month, day) {
    const d = new Date(year, month, day);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

function addCalendarTask(dateStr) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const taskName = `New Task ${dateStr}`;
    const taskLine = `  ${taskName} ${dateStr} ${dateStr}`;

    const text = editor.value;
    const newText = text.endsWith('\n') ? text + taskLine + '\n' : text + '\n' + taskLine + '\n';
    editor.value = newText;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    setTimeout(() => renderText(), 10);
}

// Update User Workload View
function updateUserWorkload(tasks) {
    try {
        // Show content, hide placeholder
        const placeholder = document.querySelector('#user-workload-view .user-workload-placeholder');
        const content = document.querySelector('#user-workload-view .user-workload-content');

        if (placeholder && content) {
            placeholder.style.display = 'none';
            content.style.display = 'block';
        }

        // Extract unique users from tasks (excluding summary tasks)
        const userMap = new Map();
        tasks.forEach(task => {
            if (task.is_summary || !task.resources) return;

            // Split resources by comma and process each
            const resources = task.resources.split(',').map(r => r.trim());
            resources.forEach(resource => {
                if (!resource) return;

                // Extract shortname (strip @ if present)
                const shortname = resource.replace('@', '').split('[')[0].trim();

                if (!userMap.has(shortname)) {
                    userMap.set(shortname, []);
                }
                userMap.get(shortname).push(task);
            });
        });

        // Populate user filter dropdown
        const userFilter = document.getElementById('userFilter');
        let currentSelection = 'all'; // Default to 'all'

        if (userFilter) {
            // Save current selection before rebuilding
            currentSelection = userFilter.value || 'all';

            // Keep "All Users" option, clear others
            userFilter.innerHTML = '<option value="all">All Users</option>';

            // Add user options (sorted alphabetically)
            const sortedUsers = Array.from(userMap.keys()).sort();
            sortedUsers.forEach(user => {
                const option = document.createElement('option');
                option.value = user;
                option.textContent = user;
                userFilter.appendChild(option);
            });

            // Restore previous selection if it still exists
            if (currentSelection !== 'all' && userMap.has(currentSelection)) {
                userFilter.value = currentSelection;
            } else {
                currentSelection = 'all'; // Reset if user no longer exists
            }
        }

        // In Overallocation mode, retain only resources with overlapping
        // dated assignments.  This is deliberately derived from the same
        // task rows as the ordinary workload view.
        if (window.onlyOverallocatedWorkload) {
            for (const [user, userTasks] of userMap) {
                const dated = userTasks
                    .filter(task => task.start && task.finish)
                    .sort((a, b) => new Date(a.start) - new Date(b.start));
                let latestFinish = null;
                const overlaps = dated.some(task => {
                    const start = new Date(task.start);
                    const finish = new Date(task.finish);
                    const overlapsExisting = latestFinish && start < latestFinish;
                    if (!latestFinish || finish > latestFinish) latestFinish = finish;
                    return overlapsExisting;
                });
                if (!overlaps) userMap.delete(user);
            }
        }

        // Store userMap globally for filtering
        window.currentUserMap = userMap;

        // Display workload with preserved filter selection
        displayUserWorkload(userMap, currentSelection);

    } catch (error) {
        console.error('Error updating user workload view:', error);
    }
}

// Display user workload (filtered or all)
function displayUserWorkload(userMap, filterUser) {
    const sectionsContainer = document.getElementById('userWorkloadSections');
    const emptyState = document.getElementById('userWorkloadEmpty');
    const emptyText = document.getElementById('userWorkloadEmptyText');
    const filterNotice = document.getElementById('userWorkloadFilterNotice');
    const titleBanner = document.getElementById('userWorkloadTitleBanner');

    if (!sectionsContainer) return;

    // #1118: the Overallocation button filters this same view down to only
    // overallocated resources (see the window.onlyOverallocatedWorkload
    // handling in updateUserWorkload() above); reflect that here so the
    // filtered state is visible and reversible from within the view itself,
    // not just by remembering to click the ribbon's Workload button again.
    if (filterNotice) filterNotice.style.display = window.onlyOverallocatedWorkload ? 'flex' : 'none';
    if (titleBanner) titleBanner.textContent = window.onlyOverallocatedWorkload
        ? 'Overallocated Resources'
        : 'User Workload Breakdown';
    if (emptyText) emptyText.textContent = window.onlyOverallocatedWorkload
        ? 'No resources are currently overallocated.'
        : 'No tasks assigned to users.';

    sectionsContainer.innerHTML = '';

    // Filter users if needed
    const usersToShow = filterUser === 'all'
        ? Array.from(userMap.keys()).sort()
        : [filterUser];

    if (usersToShow.length === 0 || (filterUser !== 'all' && !userMap.has(filterUser))) {
        if (emptyState) emptyState.style.display = 'block';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    // Create section for each user
    usersToShow.forEach(user => {
        const userTasks = userMap.get(user);
        if (!userTasks || userTasks.length === 0) return;

        // Calculate workload statistics
        const totalTasks = userTasks.length;
        const completedTasks = userTasks.filter(t => parseInt(t.percent) === 100).length;
        const totalDays = userTasks.reduce((sum, t) => sum + (t.duration_days || 0), 0);
        const completedDays = userTasks.filter(t => parseInt(t.percent) === 100)
            .reduce((sum, t) => sum + (t.duration_days || 0), 0);

        // Create user section
        const section = document.createElement('div');
        section.className = 'user-workload-section';

        // Section header with stats
        const header = document.createElement('div');
        header.className = 'user-workload-header';
        header.innerHTML = `
            <h3>👤 ${user}</h3>
            <div class="user-stats">
                <span class="stat"><strong>Tasks:</strong> ${completedTasks}/${totalTasks} complete</span>
                <span class="stat"><strong>Days:</strong> ${completedDays}/${totalDays} complete</span>
                <span class="stat"><strong>Completion:</strong> ${Math.round(completedTasks / totalTasks * 100)}%</span>
            </div>
        `;
        section.appendChild(header);

        // Create tasks table
        const tableWrapper = document.createElement('div');
        tableWrapper.className = 'user-workload-table-wrapper';

        const table = document.createElement('table');
        table.className = 'user-workload-table';

        // Table header
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th>Task Name</th>
                <th>Start</th>
                <th>Finish</th>
                <th>Duration</th>
                <th>%</th>
                <th>RAG</th>
            </tr>
        `;
        table.appendChild(thead);

        // Table body
        const tbody = document.createElement('tbody');
        userTasks.forEach(task => {
            const row = document.createElement('tr');
            row.style.cursor = 'pointer';
            row.onclick = () => openMilestoneTaskForm(task.name);

            // Task name with indentation
            const nameCell = document.createElement('td');
            const indent = '  '.repeat(task.level || 0);
            nameCell.textContent = indent + task.name;
            nameCell.style.fontFamily = 'monospace';
            row.appendChild(nameCell);

            // Start date
            const startCell = document.createElement('td');
            startCell.textContent = task.start ? new Date(task.start).toLocaleDateString() : '-';
            row.appendChild(startCell);

            // Finish date
            const finishCell = document.createElement('td');
            finishCell.textContent = task.finish ? new Date(task.finish).toLocaleDateString() : '-';
            row.appendChild(finishCell);

            // Duration
            const durationCell = document.createElement('td');
            durationCell.textContent = task.duration_days ? `${task.duration_days}d` : '-';
            row.appendChild(durationCell);

            // Percent
            const percentCell = document.createElement('td');
            percentCell.textContent = task.percent !== undefined && task.percent !== null ? `${task.percent}%` : '0%';
            row.appendChild(percentCell);

            // RAG
            const ragCell = document.createElement('td');
            ragCell.textContent = task.rag || '-';
            ragCell.style.backgroundColor = getRAGColor(task.rag);
            ragCell.style.color = '#fff';
            ragCell.style.fontWeight = 'bold';
            ragCell.style.textAlign = 'center';
            ragCell.style.borderRadius = '4px';
            row.appendChild(ragCell);

            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        tableWrapper.appendChild(table);
        section.appendChild(tableWrapper);

        sectionsContainer.appendChild(section);
    });
}

// Filter user workload by selected user
function filterUserWorkload() {
    const filterSelect = document.getElementById('userFilter');
    if (!filterSelect || !window.currentUserMap) return;

    const selectedUser = filterSelect.value;
    displayUserWorkload(window.currentUserMap, selectedUser);
}

/** Open workload with resources that have overlapping dated assignments only. */
function showOverallocationView() {
    window.onlyOverallocatedWorkload = true;
    switchToView('user-workload');
    if (typeof lastRenderedTasks !== 'undefined') updateUserWorkload(lastRenderedTasks || []);
}

/** Drop the Overallocation filter and show every resource's workload again.
 * Wired to the "Show all resources" link the filter notice banner shows
 * while showOverallocationView()'s filter is active (see #1118). */
function clearOverallocationFilter() {
    window.onlyOverallocatedWorkload = false;
    if (typeof lastRenderedTasks !== 'undefined') updateUserWorkload(lastRenderedTasks || []);
}

/** Open the stakeholder influence grid in an enlarged layout. */
function showInfluenceDiagram() {
    switchToView('stakeholders');
    requestAnimationFrame(() => document.getElementById('stakeholderGridWrapper')?.classList.add('stakeholder-grid-expanded'));
}

// ========================================
// Resource Sheet View
// ========================================

function updateResourceSheet(tasks, frontMatter = {}) {
    try {
        const placeholder = document.querySelector('#resource-sheet-view .resource-sheet-placeholder');
        const content = document.querySelector('#resource-sheet-view .resource-sheet-content');

        if (placeholder && content) {
            placeholder.style.display = 'none';
            content.style.display = 'block';
        }

        const monthRow = document.getElementById('resourceSheetMonthRow');
        const dayRow = document.getElementById('resourceSheetDayRow');
        const tbody = document.getElementById('resourceSheetBody');

        if (!monthRow || !dayRow || !tbody) {
            console.error('Resource sheet table elements not found');
            return;
        }

        // Keep static header cells, remove dynamic date columns
        while (monthRow.children.length > 4) monthRow.removeChild(monthRow.lastChild);
        while (dayRow.children.length > 0) dayRow.removeChild(dayRow.lastChild);
        tbody.innerHTML = '';

        // Filter tasks: non-summary with dates and resources
        const validTasks = tasks.filter(t =>
            !t.is_summary && t.start && t.finish && t.resources && t.resources !== '-'
        );

        if (validTasks.length === 0) {
            tbody.innerHTML = '<tr><td colspan="100%" style="text-align:center;padding:20px;">No tasks with resources and dates found</td></tr>';
            return;
        }

        // Parse holidays and non-working days from front matter
        const holidays = [];
        for (const fmKey of ['holidays', 'non-working-days']) {
            if (frontMatter[fmKey]) {
                const val = typeof frontMatter[fmKey] === 'string' ? frontMatter[fmKey] : '';
                const dateMatches = val.match(/\d{4}-\d{2}-\d{2}/g);
                if (dateMatches) {
                    dateMatches.forEach(d => { if (!holidays.includes(d)) holidays.push(d); });
                }
                // Handle array format (new named entries list)
                if (Array.isArray(frontMatter[fmKey])) {
                    frontMatter[fmKey].forEach(h => {
                        if (typeof h === 'string') {
                            // Named entry: "Christmas: 2026-12-25:2026-12-26" or bare date
                            const namedMatch = h.match(/^.+?:\s*(\d{4}-\d{2}-\d{2})(?::(\d{4}-\d{2}-\d{2}))?\s*$/);
                            if (namedMatch) {
                                const start = new Date(namedMatch[1] + 'T00:00:00');
                                const end = namedMatch[2] ? new Date(namedMatch[2] + 'T00:00:00') : start;
                                for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                                    const ds = d.toISOString().slice(0, 10);
                                    if (!holidays.includes(ds)) holidays.push(ds);
                                }
                            } else if (/^\d{4}-\d{2}-\d{2}$/.test(h.trim())) {
                                if (!holidays.includes(h.trim())) holidays.push(h.trim());
                            }
                        }
                    });
                }
            }
        }

        // Determine date range
        let minDate = null;
        let maxDate = null;
        validTasks.forEach(task => {
            const start = parseLocalDate(task.start);
            const finish = parseLocalDate(task.finish);
            if (!minDate || start < minDate) minDate = new Date(start);
            if (!maxDate || finish > maxDate) maxDate = new Date(finish);
        });

        // Build date columns
        const dates = [];
        const current = new Date(minDate);
        while (current <= maxDate) {
            dates.push(new Date(current));
            current.setDate(current.getDate() + 1);
        }

        // Build month headers
        let currentMonth = -1;
        let currentYear = -1;
        let monthSpan = 0;
        let monthTh = null;
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        dates.forEach((date, i) => {
            const m = date.getMonth();
            const y = date.getFullYear();

            if (m !== currentMonth || y !== currentYear) {
                if (monthTh) {
                    monthTh.colSpan = monthSpan;
                    monthRow.appendChild(monthTh);
                }
                monthTh = document.createElement('th');
                monthTh.className = 'resource-sheet-month-header';
                monthTh.textContent = `${monthNames[m]} ${y}`;
                monthSpan = 1;
                currentMonth = m;
                currentYear = y;
            } else {
                monthSpan++;
            }

            // Day number header
            const dayTh = document.createElement('th');
            dayTh.className = 'resource-sheet-day-header';
            dayTh.textContent = date.getDate();
            const dayOfWeek = date.getDay();
            if (dayOfWeek === 0 || dayOfWeek === 6) dayTh.classList.add('resource-sheet-weekend');
            const dateKey = date.toISOString().split('T')[0];
            if (holidays.includes(dateKey)) dayTh.classList.add('resource-sheet-holiday');
            dayRow.appendChild(dayTh);
        });
        // Append last month header
        if (monthTh) {
            monthTh.colSpan = monthSpan;
            monthRow.appendChild(monthTh);
        }

        // Group tasks by resource
        const resourceTasks = {};
        validTasks.forEach(task => {
            const resources = task.resources.split(',').map(r => r.trim()).filter(r => r && r !== '-');
            resources.forEach(resource => {
                let resourceName = resource;
                const allocationMatch = resource.match(/^(.+?)\[(\d+)%\]$/);
                if (allocationMatch) resourceName = allocationMatch[1].trim();

                if (!resourceTasks[resourceName]) {
                    resourceTasks[resourceName] = [];
                }
                resourceTasks[resourceName].push(task);
            });
        });

        // Build a map of which dates each resource is working on (for overlap detection)
        const resourceDateCount = {};
        Object.keys(resourceTasks).forEach(resource => {
            resourceDateCount[resource] = {};
            resourceTasks[resource].forEach(task => {
                const taskStart = parseLocalDate(task.start);
                const taskFinish = parseLocalDate(task.finish);
                const d = new Date(taskStart);
                while (d <= taskFinish) {
                    const dayOfWeek = d.getDay();
                    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                        const key = d.toISOString().split('T')[0];
                        resourceDateCount[resource][key] = (resourceDateCount[resource][key] || 0) + 1;
                    }
                    d.setDate(d.getDate() + 1);
                }
            });
        });

        // Store data for filtering
        window.resourceSheetData = { resourceTasks, resourceDateCount, dates, holidays };

        // Populate filter dropdown
        const filterSelect = document.getElementById('resourceSheetFilter');
        if (filterSelect) {
            const currentSelection = filterSelect.value || 'all';
            filterSelect.innerHTML = '<option value="all">All Resources</option>';
            Object.keys(resourceTasks).sort().forEach(resource => {
                const option = document.createElement('option');
                option.value = resource;
                option.textContent = resource;
                filterSelect.appendChild(option);
            });
            if (currentSelection !== 'all' && resourceTasks[currentSelection]) {
                filterSelect.value = currentSelection;
            }
        }

        // Render the sheet
        renderResourceSheet(filterSelect ? filterSelect.value : 'all');

    } catch (error) {
        console.error('Error updating resource sheet:', error);
    }
}

function renderResourceSheet(filterValue) {
    const data = window.resourceSheetData;
    if (!data) return;

    const { resourceTasks, resourceDateCount, dates, holidays } = data;
    const tbody = document.getElementById('resourceSheetBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    const resourcesToShow = filterValue === 'all'
        ? Object.keys(resourceTasks).sort()
        : [filterValue];

    resourcesToShow.forEach(resource => {
        const tasks = resourceTasks[resource];
        if (!tasks) return;

        // Resource header row
        const headerRow = document.createElement('tr');
        headerRow.className = 'resource-sheet-group-header';
        const headerCell = document.createElement('td');
        headerCell.colSpan = 4 + dates.length;
        headerCell.textContent = resource;
        headerCell.className = 'resource-sheet-group-name';
        headerRow.appendChild(headerCell);
        tbody.appendChild(headerRow);

        // Task rows
        tasks.forEach(task => {
            const row = document.createElement('tr');
            row.className = 'resource-sheet-task-row';
            row.style.cursor = 'pointer';
            row.onclick = () => openMilestoneTaskForm(task.name);

            // Task name
            const nameCell = document.createElement('td');
            nameCell.className = 'resource-sheet-task-name';
            nameCell.textContent = task.name;
            row.appendChild(nameCell);

            // Start date
            const startCell = document.createElement('td');
            startCell.className = 'resource-sheet-date-cell';
            startCell.textContent = task.start ? formatDateShort(task.start) : '-';
            row.appendChild(startCell);

            // Finish date
            const finishCell = document.createElement('td');
            finishCell.className = 'resource-sheet-date-cell';
            finishCell.textContent = task.finish ? formatDateShort(task.finish) : '-';
            row.appendChild(finishCell);

            // Percent
            const pctCell = document.createElement('td');
            pctCell.className = 'resource-sheet-pct-cell';
            pctCell.textContent = (task.percent !== undefined && task.percent !== null) ? `${task.percent}%` : '0%';
            row.appendChild(pctCell);

            // Timeline cells
            const taskStart = parseLocalDate(task.start);
            const taskFinish = parseLocalDate(task.finish);

            dates.forEach(date => {
                const cell = document.createElement('td');
                cell.className = 'resource-sheet-timeline-cell';

                const dayOfWeek = date.getDay();
                const dateKey = date.toISOString().split('T')[0];

                if (dayOfWeek === 0 || dayOfWeek === 6) {
                    cell.classList.add('resource-sheet-weekend');
                }
                if (holidays.includes(dateKey)) {
                    cell.classList.add('resource-sheet-holiday');
                }

                // Check if this date falls within the task range
                if (date >= taskStart && date <= taskFinish && dayOfWeek !== 0 && dayOfWeek !== 6) {
                    cell.classList.add('resource-sheet-active');

                    // Check for overlap (resource has multiple tasks on this date)
                    const overlapCount = resourceDateCount[resource][dateKey] || 0;
                    if (overlapCount > 1) {
                        cell.classList.add('resource-sheet-overlap');
                        cell.title = `${resource} has ${overlapCount} tasks on ${dateKey}`;
                    }
                }

                row.appendChild(cell);
            });

            tbody.appendChild(row);
        });
    });
}

function filterResourceSheet() {
    const filterSelect = document.getElementById('resourceSheetFilter');
    if (!filterSelect) return;
    renderResourceSheet(filterSelect.value);
}

// Format a date string as short date (e.g., "15 Jan")
function formatDateShort(dateStr) {
    const date = parseLocalDate(dateStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${date.getDate()} ${months[date.getMonth()]}`;
}

// Map descriptive RAG status to colour category
function ragStatusToColour(rag) {
    if (!rag) return '';
    const lower = rag.toLowerCase();
    const mapping = {
        'not started': 'green',
        'on track': 'green',
        'ahead of schedule': 'green',
        'complete': 'blue',
        'behind schedule': 'amber',
        'task overdue': 'red',
        // Legacy values
        'green': 'green',
        'amber': 'amber',
        'red': 'red',
    };
    return mapping[lower] || '';
}

// Helper function to get RAG color
function getRAGColor(rag) {
    if (!rag) return '#ccc';
    const colour = ragStatusToColour(rag);
    switch(colour) {
        case 'red': return '#d32f2f';
        case 'amber': return '#f57c00';
        case 'green': return '#388e3c';
        case 'blue': return '#1976d2';
        default: return '#ccc';
    }
}

function getColumnMapping() {
    const fields = ['task_name', 'start_date', 'end_date', 'duration', 'resources', 'percent_complete', 'priority', 'bucket', 'comment', 'depends_on'];
    const mapping = {};
    fields.forEach(f => {
        const el = document.getElementById('wizardMap_' + f);
        if (el && el.value) mapping[f] = el.value;
    });
    return mapping;
}

function updateWizardStepUI() {
    // Step indicators
    for (let i = 1; i <= 3; i++) {
        const indicator = document.getElementById('wizardStep' + i + 'Indicator');
        indicator.classList.toggle('active', i === excelWizardStep);
        indicator.classList.toggle('completed', i < excelWizardStep);
    }

    // Panels
    document.getElementById('wizardStep1').style.display = excelWizardStep === 1 ? 'block' : 'none';
    document.getElementById('wizardStep2').style.display = excelWizardStep === 2 ? 'block' : 'none';
    document.getElementById('wizardStep3').style.display = excelWizardStep === 3 ? 'block' : 'none';

    // Buttons
    document.getElementById('wizardBackBtn').style.display = excelWizardStep > 1 ? 'inline-block' : 'none';
    document.getElementById('wizardNextBtn').style.display = excelWizardStep < 3 ? 'inline-block' : 'none';
    document.getElementById('wizardImportBtn').style.display = excelWizardStep === 3 ? 'inline-block' : 'none';
}

async function wizardNext() {
    if (excelWizardStep === 1) {
        // Step 1 -> 2: Populate column mapping
        const sheetName = document.getElementById('wizardSheetSelect').value;
        const sheet = excelWizardData.sheets.find(s => s.name === sheetName);
        if (!sheet) return;

        buildMappingGrid(sheet.columns);
        excelWizardStep = 2;
        updateWizardStepUI();
        document.getElementById('wizardNextBtn').disabled = false;

    } else if (excelWizardStep === 2) {
        // Step 2 -> 3: Convert and preview
        const mapping = getColumnMapping();
        if (!mapping.task_name) {
            alert('Task Name mapping is required.');
            return;
        }

        document.getElementById('wizardSpinner').style.display = 'block';
        document.getElementById('wizardNextBtn').disabled = true;

        const sheetName = document.getElementById('wizardSheetSelect').value;
        const formData = new FormData();
        formData.append('file', excelWizardFile);
        formData.append('sheet_name', sheetName);
        formData.append('column_mapping', JSON.stringify(mapping));

        try {
            const response = await fetch('/api/excel/convert', { method: 'POST', body: formData });
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || 'Failed to convert file');
            }
            const result = await response.json();

            // Show warnings
            const warningsDiv = document.getElementById('wizardConvertWarnings');
            if (result.warnings && result.warnings.length > 0) {
                warningsDiv.innerHTML = '<strong>Warnings:</strong><ul>' +
                    result.warnings.map(w => '<li>' + escapeHtml(w) + '</li>').join('') + '</ul>';
                warningsDiv.style.display = 'block';
            } else {
                warningsDiv.style.display = 'none';
            }

            // Show stats
            document.getElementById('wizardConvertStats').textContent =
                'Found ' + result.phase_count + ' phase(s) and ' + result.task_count + ' task(s)';

            // Show markdown preview
            document.getElementById('wizardMarkdownPreview').value = result.markdown;

            excelWizardStep = 3;
            updateWizardStepUI();
        } catch (e) {
            alert('Conversion failed: ' + e.message);
            document.getElementById('wizardNextBtn').disabled = false;
        } finally {
            document.getElementById('wizardSpinner').style.display = 'none';
        }
    }
}

function wizardBack() {
    if (excelWizardStep > 1) {
        excelWizardStep--;
        updateWizardStepUI();
        if (excelWizardStep === 1) {
            document.getElementById('wizardNextBtn').disabled = !document.getElementById('wizardSheetSelect').value;
        } else {
            document.getElementById('wizardNextBtn').disabled = false;
        }
    }
}

function wizardImport() {
    const markdown = document.getElementById('wizardMarkdownPreview').value;
    if (!markdown) return;

    // Clear RAID log entries and highlights BEFORE loading new plan
    clearPlanTrackingData();

    // Save current project before creating a new one
    saveCurrentProjectState();

    // Create a new project using the imported filename (without extension)
    const projectName = excelWizardFile
        ? excelWizardFile.name.replace(/\.(xlsx?|csv)$/i, '')
        : 'Imported Plan';
    const project = createProject(projectName);
    saveProject(project.id, { planText: markdown });
    setCurrentProjectId(project.id);
    updateProjectBreadcrumb(project.name);

    const editor = document.getElementById('planEditor');
    editor.value = markdown;

    // Update kanban editor too
    const kanbanEditor = document.getElementById('kanbanPlanEditor');
    if (kanbanEditor) {
        kanbanEditor.value = markdown;
    }

    // Switch to editor tab
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    const editorTab = document.querySelector('[onclick*="editor"]');
    if (editorTab) editorTab.classList.add('active');
    document.getElementById('editor-tab').classList.add('active');

    editor.dispatchEvent(new Event('input'));

    closeExcelWizard();

    // Refresh project selectors
    if (typeof refreshProjectSelectors === 'function') {
        refreshProjectSelectors();
    }

    // Render the imported plan
    renderText();
}

/*
 * RAID Markdown Editor
 */
// RAID editor state is now in state.js

function toggleRaidEditor() {
    const body = document.getElementById('raidEditorBody');
    const toggle = document.getElementById('raidEditorToggle');
    const actions = document.getElementById('raidEditorActions');

    if (body && toggle && actions) {
        const isCollapsed = body.classList.contains('collapsed');
        if (isCollapsed) {
            body.classList.remove('collapsed');
            toggle.textContent = '▼';
            actions.style.display = '';
            updateRaidMarkdownEditor();
        } else {
            body.classList.add('collapsed');
            toggle.textContent = '▶';
            actions.style.display = 'none';
        }
    }
}

function updateRaidMarkdownEditor() {
    if (raidEditorIsUpdating) return;

    const editor = document.getElementById('raidMarkdownEditor');
    const body = document.getElementById('raidEditorBody');
    if (!editor || !body || body.classList.contains('collapsed')) return;

    raidEditorIsUpdating = true;
    editor.value = generateRaidMarkdown();
    raidEditorIsUpdating = false;
}

function onRaidMarkdownEdit() {
    if (raidEditorIsUpdating) return;

    clearTimeout(raidEditorDebounceTimer);
    raidEditorDebounceTimer = setTimeout(function() {
        const editor = document.getElementById('raidMarkdownEditor');
        if (!editor) return;

        raidEditorIsUpdating = true;
        const items = parseRaidMarkdown(editor.value);
        if (items.length > 0) {
            raidItems = items;
            raidNextId = Math.max(...items.map(i => i.id)) + 1;
            renderRaidTable();
        }
        // Re-format the markdown to keep alignment correct
        editor.value = generateRaidMarkdown();
        raidEditorIsUpdating = false;
    }, 500);
}

function uploadRaidMarkdownFromEditor() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.txt';
    input.onchange = function(event) {
        uploadRaidMarkdown(event);
    };
    input.click();
}

// Wire up RAID markdown editor input event
document.addEventListener('DOMContentLoaded', function() {
    const raidEditor = document.getElementById('raidMarkdownEditor');
    if (raidEditor) {
        raidEditor.addEventListener('input', onRaidMarkdownEdit);
    }
});


/*
 * Budget Tracker System
 * Tracks project costs, forecasts, and spending.
 */

// =====================================================================
// Communications Plan
// =====================================================================

function clearCommsEntries() {
    commsItems = [];
    commsNextId = 1;
    renderCommsTable();
}

async function exportCommsToWord() {
    if (commsItems.length === 0) {
        if (typeof setStatusMessage === 'function') setStatusMessage('No comms items to export', 3000);
        return;
    }

    const projectName = document.getElementById('reportProjectTitle')?.textContent || 'Project';

    // Built in the browser with the vendored docx library; nothing is sent to
    // the server (issue #792). The /api/comms/export-docx route stays
    // available behind localStorage np-server-exports=1.
    if (!useServerExports()) {
        try {
            const { exportCommsDocxInBrowser } = await import('/static/docx-export.js');
            await exportCommsDocxInBrowser(commsItems, projectName);
            if (typeof setStatusMessage === 'function') setStatusMessage('Comms plan exported', 3000);
        } catch (e) {
            console.error('Comms export error:', e);
            if (typeof setStatusMessage === 'function') setStatusMessage('Failed to export comms plan: ' + e.message, 3000);
        }
        return;
    }

    try {
        const response = await fetch('/api/comms/export-docx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: commsItems, project_name: projectName })
        });

        if (!response.ok) throw new Error('Export failed');

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = response.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'Communications Plan.docx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (typeof setStatusMessage === 'function') setStatusMessage('Comms plan exported', 3000);
    } catch (e) {
        console.error('Comms export error:', e);
        if (typeof setStatusMessage === 'function') setStatusMessage('Failed to export comms plan', 3000);
    }
}

function addCommsItem() {
    openCommsForm(null);
}

function openCommsForm(itemId) {
    const title = document.getElementById('commsFormTitle');
    const idField = document.getElementById('commsItemId');
    const deleteRow = document.getElementById('commsDeleteButtonRow');

    if (itemId != null) {
        const item = commsItems.find(i => i.id === itemId);
        if (!item) return;

        title.textContent = 'Edit Comms Item';
        idField.value = item.id;
        document.getElementById('commsItemActivity').value = item.activity || '';
        document.getElementById('commsItemAudience').value = item.audience || '';
        document.getElementById('commsItemContent').value = item.content || '';
        document.getElementById('commsItemFrequency').value = item.frequency || 'Weekly';
        document.getElementById('commsItemChannel').value = item.channel || '';
        document.getElementById('commsItemOwner').value = item.owner || '';
        document.getElementById('commsItemStatus').value = item.status || 'Planned';
        if (deleteRow) deleteRow.style.display = 'block';
    } else {
        title.textContent = 'New Comms Item';
        idField.value = '';
        document.getElementById('commsItemActivity').value = '';
        document.getElementById('commsItemAudience').value = '';
        document.getElementById('commsItemContent').value = '';
        document.getElementById('commsItemFrequency').value = 'Weekly';
        document.getElementById('commsItemChannel').value = '';
        document.getElementById('commsItemOwner').value = '';
        document.getElementById('commsItemStatus').value = 'Planned';
        if (deleteRow) deleteRow.style.display = 'none';
    }

    openDetailPane('commsFormSection');
}

function closeCommsForm() {
    closeDetailPane();
}

function saveCommsItemFromForm() {
    const idField = document.getElementById('commsItemId').value;
    const activity = document.getElementById('commsItemActivity').value.trim();

    if (!activity) {
        alert('Please enter an activity for the comms item.');
        return;
    }

    const itemData = {
        activity: activity,
        audience: document.getElementById('commsItemAudience').value.trim(),
        content: document.getElementById('commsItemContent').value.trim(),
        frequency: document.getElementById('commsItemFrequency').value,
        channel: document.getElementById('commsItemChannel').value.trim(),
        owner: document.getElementById('commsItemOwner').value.trim(),
        status: document.getElementById('commsItemStatus').value,
    };

    if (idField) {
        const existingId = parseInt(idField);
        const index = commsItems.findIndex(i => i.id === existingId);
        if (index >= 0) {
            commsItems[index] = { ...commsItems[index], ...itemData };
        }
    } else {
        itemData.id = commsNextId++;
        commsItems.push(itemData);
    }

    closeCommsForm();
    renderCommsTable();
    forceCommsSync();
}

function forceCommsSync() {
    syncCommsLogToPlanText();
    // Verify the sync happened — if not, force append
    const editor = document.getElementById('planEditor');
    if (editor && commsItems.length > 0 && !editor.value.includes(COMMS_START)) {
        const table = generateCommsMarkdown();
        if (table) {
            editor.value = editor.value.trimEnd() + '\n\n' + COMMS_START + '\n' + table;
            if (editor._updateLineNumbers) editor._updateLineNumbers();
            editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }
}

function deleteCommsItem(id) {
    if (!confirm('Are you sure you want to delete this comms item?')) return;
    commsItems = commsItems.filter(i => i.id !== id);
    renderCommsTable();
    forceCommsSync();
}

function confirmDeleteCommsItem() {
    const idField = document.getElementById('commsItemId').value;
    if (!idField) return;

    commsItemPendingDeleteId = parseInt(idField);
    const item = commsItems.find(i => i.id === commsItemPendingDeleteId);
    const itemTitle = item ? item.activity : 'this item';

    const msg = document.getElementById('commsDeleteConfirmMessage');
    if (msg) {
        msg.textContent = 'Are you sure you want to delete "' + itemTitle + '"? This action cannot be undone.';
    }

    const overlay = document.getElementById('commsDeleteConfirmOverlay');
    if (overlay) overlay.classList.add('active');
}

function cancelDeleteCommsItem() {
    commsItemPendingDeleteId = null;
    const overlay = document.getElementById('commsDeleteConfirmOverlay');
    if (overlay) overlay.classList.remove('active');
}

function executeDeleteCommsItem() {
    if (commsItemPendingDeleteId == null) return;

    commsItems = commsItems.filter(i => i.id !== commsItemPendingDeleteId);
    commsItemPendingDeleteId = null;

    const overlay = document.getElementById('commsDeleteConfirmOverlay');
    if (overlay) overlay.classList.remove('active');

    closeCommsForm();
    renderCommsTable();
    syncCommsLogToPlanText();
}

function renderCommsTable() {
    try {
        const tbody = document.getElementById('commsTableBody');
        const emptyState = document.getElementById('commsEmptyState');
        if (!tbody || !emptyState) {
            console.warn('Comms table elements not found in DOM');
            return;
        }
        const filterStatusEl = document.getElementById('commsFilterStatus');
        const filterStatus = filterStatusEl ? filterStatusEl.value : 'all';

        let filtered = commsItems.filter(item => {
            if (filterStatus !== 'all' && item.status !== filterStatus) return false;
            return true;
        });

        filtered.sort((a, b) => {
            let valA = a[commsSortColumn];
            let valB = b[commsSortColumn];

            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();

            if (valA < valB) return commsSortAsc ? -1 : 1;
            if (valA > valB) return commsSortAsc ? 1 : -1;
            return 0;
        });

        tbody.innerHTML = '';

        if (commsItems.length === 0) {
            emptyState.hidden = false;
            document.getElementById('commsTable').style.display = 'none';
            return;
        }

        emptyState.hidden = true;
        document.getElementById('commsTable').style.display = 'table';

        filtered.forEach(item => {
            try {
                const row = document.createElement('tr');
                const statusClass = (item.status || 'Planned').toLowerCase();

                row.innerHTML = `
                    <td>${item.id || ''}</td>
                    <td title="${escapeHtml(item.activity)}">${escapeHtml(item.activity)}</td>
                    <td title="${escapeHtml(item.audience)}">${escapeHtml(item.audience)}</td>
                    <td title="${escapeHtml(item.content)}">${escapeHtml(item.content)}</td>
                    <td>${escapeHtml(item.frequency)}</td>
                    <td>${escapeHtml(item.channel)}</td>
                    <td>${escapeHtml(item.owner)}</td>
                    <td><span class="raid-status-badge raid-status-${statusClass}">${escapeHtml(item.status)}</span></td>
                    <td>
                        <np-button icon-only variant="neutral" size="small" title="Edit" label="Edit" onclick="openCommsForm(${item.id})"><span slot="icon">&#9998;&#65039;</span></np-button>
                        <np-button icon-only variant="neutral" size="small" title="Open source row in plan editor" label="Open source row in plan editor" onclick="SectionFolding.jumpToBackMatterSection('---comms---', ${item.id}, 'tasks')"><i class="bi bi-code-slash" slot="icon"></i></np-button>
                        <np-button icon-only variant="danger" size="small" title="Delete" label="Delete" onclick="deleteCommsItem(${item.id})"><span slot="icon">&#128465;&#65039;</span></np-button>
                    </td>
                `;
                tbody.appendChild(row);
            } catch (itemError) {
                console.warn('Skipping malformed comms item during render:', item, itemError);
            }
        });

        updateCommsSortIndicators();
        syncCommsLogToPlanText();
    } catch (error) {
        console.error('Error rendering comms table:', error);
    }
}

function sortCommsTable(column) {
    if (commsSortColumn === column) {
        commsSortAsc = !commsSortAsc;
    } else {
        commsSortColumn = column;
        commsSortAsc = true;
    }
    renderCommsTable();
}

function updateCommsSortIndicators() {
    const table = document.getElementById('commsTable');
    if (!table) return;
    const headers = table.querySelectorAll('th');
    headers.forEach(th => {
        const indicator = th.querySelector('.sort-indicator');
        if (indicator) {
            const onclick = th.getAttribute('onclick');
            if (onclick && onclick.includes(`'${commsSortColumn}'`)) {
                indicator.textContent = commsSortAsc ? '\u25B2' : '\u25BC';
            } else {
                indicator.textContent = '';
            }
        }
    });
}

function loadCommsItemsFromData(items) {
    try {
        if (!items || items.length === 0) return;
        if (commsItems.length > 0) return;

        commsItems = items;
        commsNextId = Math.max(...items.map(i => i.id || 0)) + 1;
        renderCommsTable();
    } catch (error) {
        console.error('Error loading comms items:', error);
    }
}

function extractCommsItemsFromPlanText(planText) {
    try {
        const commsText = extractCommsFromPlanText(planText);
        if (!commsText) return [];
        return parseCommsMarkdown(commsText);
    } catch (error) {
        console.error('Error extracting comms items from plan text:', error);
        return [];
    }
}

function extractCommsFromPlanText(planText) {
    const startIdx = planText.indexOf(COMMS_START);
    if (startIdx === -1) return '';

    const afterStart = startIdx + COMMS_START.length;

    let endIdx = planText.length;
    for (const marker of [LESSONS_START, BASELINE_START, WHITEBOARD_START]) {
        const mIdx = planText.indexOf(marker, afterStart);
        if (mIdx !== -1 && mIdx < endIdx) endIdx = mIdx;
    }

    return planText.substring(afterStart, endIdx).trim();
}

function parseCommsMarkdown(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);

    let headerIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        const lower = lines[i].toLowerCase();
        if (lower.includes('|') && (lower.includes('activity') || lower.includes('audience'))) {
            headerIndex = i;
            break;
        }
    }

    if (headerIndex === -1) return [];

    function parseRow(line) {
        const parts = line.split('|');
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

    const colMap = {};
    const aliases = {
        'id': 'id', 'activity': 'activity', 'audience': 'audience',
        'content': 'content', 'frequency': 'frequency',
        'channel': 'channel', 'owner': 'owner', 'status': 'status'
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
        let itemId = (idStr && /^\d+$/.test(idStr)) ? parseInt(idStr) : maxId + 1;
        maxId = Math.max(maxId, itemId);

        items.push({
            id: itemId,
            activity: getCell('activity', ''),
            audience: getCell('audience', ''),
            content: getCell('content', ''),
            frequency: getCell('frequency', 'Weekly'),
            channel: getCell('channel', ''),
            owner: getCell('owner', ''),
            status: getCell('status', 'Planned'),
        });
    }

    return items;
}

function generateCommsMarkdown() {
    if (commsItems.length === 0) return '';

    const headers = ['ID', 'Activity', 'Audience', 'Content', 'Frequency', 'Channel', 'Owner', 'Status'];
    const escPipe = (text) => String(text || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

    const rows = commsItems.map(item => [
        String(item.id),
        escPipe(item.activity),
        escPipe(item.audience),
        escPipe(item.content),
        escPipe(item.frequency),
        escPipe(item.channel),
        escPipe(item.owner),
        escPipe(item.status),
    ]);

    // Calculate column widths
    const widths = headers.map(h => h.length);
    rows.forEach(row => {
        row.forEach((cell, i) => {
            widths[i] = Math.max(widths[i], cell.length);
        });
    });

    const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));
    const formatRow = (cells) => '| ' + cells.map((c, i) => pad(c, widths[i])).join(' | ') + ' |';
    const separator = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';

    const lines = [formatRow(headers), separator];
    rows.forEach(row => lines.push(formatRow(row)));

    return lines.join('\n');
}

function syncCommsLogToPlanText() {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const planText = editor.value;
    const updatedText = updatePlanCommsText(planText, commsItems);

    if (updatedText !== planText) {
        setEditorValuePreservingCursor(editor, updatedText);
        const kanbanEditor = document.getElementById('kanbanPlanEditor');
        if (kanbanEditor) {
            kanbanEditor.value = updatedText;
        }
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

function updatePlanCommsText(planText, items) {
    const HIGHLIGHTS_START = '---highlights---';
    const HIGHLIGHTS_END = '---end-highlights---';
    const BENEFITS_START_M = '---benefits---';

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
        [HIGHLIGHTS_END, BUDGET_START, BENEFITS_START_M, RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START]);
    const hasEndHighlights = planText.includes(HIGHLIGHTS_END);
    const budgetText = extractSection(planText, BUDGET_START,
        [BENEFITS_START_M, RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START]);
    const benefitsText = extractSection(planText, BENEFITS_START_M,
        [RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START]);
    const raidText = extractSection(planText, RAID_LOG_START, [COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START]);
    const lessonsText = extractSection(planText, LESSONS_START, [BASELINE_START, WHITEBOARD_START]);
    const baselineText = extractSection(planText, BASELINE_START, [WHITEBOARD_START]);
    const whiteboardText = extractSection(planText, WHITEBOARD_START, []);

    // Strip all special sections to get just tasks + front matter
    let base = planText;
    const sectionMarkers = [HIGHLIGHTS_START, BUDGET_START, BENEFITS_START_M, RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START];
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

    // Rebuild in canonical order: tasks, highlights, budget, benefits, raid, comms, lessons, baseline, whiteboard
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
    if (benefitsText) {
        result = result.replace(/\n+$/, '') + '\n\n' + BENEFITS_START_M + '\n' + benefitsText;
    }
    if (raidText) {
        result = result.replace(/\n+$/, '') + '\n\n' + RAID_LOG_START + '\n' + raidText;
    }

    const table = generateCommsMarkdown();
    if (table) {
        result = result.replace(/\n+$/, '') + '\n\n' + COMMS_START + '\n' + table;
    }

    if (lessonsText) {
        result = result.replace(/\n+$/, '') + '\n\n' + LESSONS_START + '\n' + lessonsText;
    }

    if (baselineText) {
        result = result.replace(/\n+$/, '') + '\n\n' + BASELINE_START + '\n' + baselineText;
    }

    if (whiteboardText) {
        result = result.replace(/\n+$/, '') + '\n\n' + WHITEBOARD_START + '\n' + whiteboardText;
    }

    return result;
}

// Budget state is now in state.js

// Budget constants are now in state.js

function clearBudgetEntries() {
    budgetItems = [];
    budgetNextId = 1;
    renderBudgetTable();
    updateReportBudgetWidget();
    console.log('Cleared budget entries');
}

function openBudgetForm(itemId) {
    const title = document.getElementById('budgetFormTitle');
    const idField = document.getElementById('budgetItemId');
    const deleteRow = document.getElementById('budgetDeleteButtonRow');

    if (itemId != null) {
        const item = budgetItems.find(i => i.id === itemId);
        if (!item) return;

        title.textContent = 'Edit Budget Item';
        idField.value = item.id;
        document.getElementById('budgetItemDescription').value = item.description || '';
        document.getElementById('budgetItemEstimate').value = item.estimate || '';
        document.getElementById('budgetItemForecast').value = item.forecast || '';
        document.getElementById('budgetItemType').value = item.type || 'Capex';
        document.getElementById('budgetItemInvoice').value = item.invoice || '';
        document.getElementById('budgetItemPO').value = item.po || '';
        document.getElementById('budgetItemSupplier').value = item.supplier || '';
        document.getElementById('budgetItemTotal').value = item.total || '';
        document.getElementById('budgetItemDateOrdered').value = item.date_ordered || '';
        document.getElementById('budgetItemDateReceived').value = item.date_received || '';
        document.getElementById('budgetItemCategory').value = item.category || 'Consultancy';
        if (deleteRow) deleteRow.style.display = 'block';
    } else {
        title.textContent = 'New Budget Item';
        idField.value = '';
        document.getElementById('budgetItemDescription').value = '';
        document.getElementById('budgetItemEstimate').value = '';
        document.getElementById('budgetItemForecast').value = '';
        document.getElementById('budgetItemType').value = 'Capex';
        document.getElementById('budgetItemInvoice').value = '';
        document.getElementById('budgetItemPO').value = '';
        document.getElementById('budgetItemSupplier').value = '';
        document.getElementById('budgetItemTotal').value = '';
        document.getElementById('budgetItemDateOrdered').value = '';
        document.getElementById('budgetItemDateReceived').value = '';
        document.getElementById('budgetItemCategory').value = 'Consultancy';
        if (deleteRow) deleteRow.style.display = 'none';
    }

    openDetailPane('budgetFormSection');
}

function closeBudgetForm() {
    closeDetailPane();
}

function saveBudgetItemFromForm() {
    const idField = document.getElementById('budgetItemId').value;
    const description = document.getElementById('budgetItemDescription').value.trim();

    if (!description) {
        alert('Please enter a description for the budget item.');
        return;
    }

    const itemData = {
        description: description,
        estimate: parseFloat(document.getElementById('budgetItemEstimate').value) || 0,
        forecast: parseFloat(document.getElementById('budgetItemForecast').value) || 0,
        type: document.getElementById('budgetItemType').value,
        invoice: document.getElementById('budgetItemInvoice').value.trim(),
        po: document.getElementById('budgetItemPO').value.trim(),
        supplier: document.getElementById('budgetItemSupplier').value.trim(),
        total: parseFloat(document.getElementById('budgetItemTotal').value) || 0,
        date_ordered: document.getElementById('budgetItemDateOrdered').value,
        date_received: document.getElementById('budgetItemDateReceived').value,
        category: document.getElementById('budgetItemCategory').value
    };

    if (idField) {
        const existingId = parseInt(idField);
        const index = budgetItems.findIndex(i => i.id === existingId);
        if (index >= 0) {
            budgetItems[index] = { ...budgetItems[index], ...itemData };
        }
    } else {
        itemData.id = budgetNextId++;
        budgetItems.push(itemData);
    }

    closeBudgetForm();
    renderBudgetTable();
    syncBudgetToPlanText();
    updateReportBudgetWidget();
}

// budgetItemPendingDeleteId is now in state.js

function confirmDeleteBudgetItem() {
    const idField = document.getElementById('budgetItemId').value;
    if (!idField) return;

    budgetItemPendingDeleteId = parseInt(idField);
    const item = budgetItems.find(i => i.id === budgetItemPendingDeleteId);
    const itemDesc = item ? item.description : 'this item';

    const msg = document.getElementById('budgetDeleteConfirmMessage');
    if (msg) {
        msg.textContent = 'Are you sure you want to delete "' + itemDesc + '"? This action cannot be undone.';
    }

    const overlay = document.getElementById('budgetDeleteConfirmOverlay');
    if (overlay) overlay.classList.add('active');
}

function cancelDeleteBudgetItem() {
    budgetItemPendingDeleteId = null;
    const overlay = document.getElementById('budgetDeleteConfirmOverlay');
    if (overlay) overlay.classList.remove('active');
}

function executeDeleteBudgetItem() {
    if (budgetItemPendingDeleteId == null) return;

    budgetItems = budgetItems.filter(i => i.id !== budgetItemPendingDeleteId);
    budgetItemPendingDeleteId = null;

    const overlay = document.getElementById('budgetDeleteConfirmOverlay');
    if (overlay) overlay.classList.remove('active');

    closeBudgetForm();
    renderBudgetTable();
    syncBudgetToPlanText();
    updateReportBudgetWidget();
}

function deleteBudgetItem(id) {
    if (!confirm('Are you sure you want to delete this budget item?')) return;
    budgetItems = budgetItems.filter(i => i.id !== id);
    renderBudgetTable();
    syncBudgetToPlanText();
    updateReportBudgetWidget();
}

function renderBudgetTable() {
    try {
        const tbody = document.getElementById('budgetTableBody');
        const tfoot = document.getElementById('budgetTableFoot');
        const emptyState = document.getElementById('budgetEmptyState');
        const table = document.getElementById('budgetTable');
        if (!tbody || !emptyState) {
            console.warn('Budget table elements not found in DOM');
            return;
        }

        const filterCategoryEl = document.getElementById('budgetCategoryFilter');
        const filterTypeEl = document.getElementById('budgetTypeFilter');
        const filterSupplierEl = document.getElementById('budgetSupplierFilter');
        const filterCategory = filterCategoryEl ? filterCategoryEl.value : 'all';
        const filterType = filterTypeEl ? filterTypeEl.value : 'all';
        const filterSupplier = filterSupplierEl ? filterSupplierEl.value.toLowerCase().trim() : '';

        let filtered = budgetItems.filter(item => {
            if (filterCategory !== 'all' && item.category !== filterCategory) return false;
            if (filterType !== 'all' && item.type !== filterType) return false;
            if (filterSupplier && !(item.supplier || '').toLowerCase().includes(filterSupplier)) return false;
            return true;
        });

        filtered.sort((a, b) => {
            let valA = a[budgetSortColumn];
            let valB = b[budgetSortColumn];

            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();
            if (typeof valA === 'number' || typeof valB === 'number') {
                valA = Number(valA) || 0;
                valB = Number(valB) || 0;
            }

            if (valA < valB) return budgetSortAsc ? -1 : 1;
            if (valA > valB) return budgetSortAsc ? 1 : -1;
            return 0;
        });

        tbody.innerHTML = '';

        if (budgetItems.length === 0) {
            emptyState.hidden = false;
            if (table) table.style.display = 'none';
            return;
        }

        emptyState.hidden = true;
        if (table) table.style.display = 'table';

        let totalEstimate = 0;
        let totalForecast = 0;
        let totalSpend = 0;

        filtered.forEach(item => {
            try {
                const row = document.createElement('tr');
                const typeClass = 'budget-type-' + (item.type || 'Capex').toLowerCase().replace(/[^a-z]/g, '-');

                row.innerHTML =
                    '<td>' + (item.id || '') + '</td>' +
                    '<td title="' + escapeHtml(item.description) + '">' + escapeHtml(item.description) + '</td>' +
                    '<td>' + formatCurrency(item.estimate) + '</td>' +
                    '<td>' + formatCurrency(item.forecast) + '</td>' +
                    '<td><span class="budget-type-badge ' + typeClass + '">' + escapeHtml(item.type) + '</span></td>' +
                    '<td><span class="budget-category-badge">' + escapeHtml(item.category) + '</span></td>' +
                    '<td>' + escapeHtml(item.supplier) + '</td>' +
                    '<td>' + formatCurrency(item.total) + '</td>' +
                    '<td>' + escapeHtml(item.date_ordered) + '</td>' +
                    '<td>' + escapeHtml(item.date_received) + '</td>' +
                    '<td>' +
                        '<np-button icon-only variant="neutral" size="large" title="Edit" label="Edit" onclick="openBudgetForm(' + item.id + ')"><span slot="icon">&#9998;&#65039;</span></np-button>' +
                        '<np-button icon-only variant="neutral" size="large" title="Open source row in plan editor" label="Open source row in plan editor" onclick="SectionFolding.jumpToBackMatterSection(\'---budget---\', ' + item.id + ', \'tasks\')"><i class="bi bi-code-slash" slot="icon"></i></np-button>' +
                        '<np-button icon-only variant="danger" size="large" title="Delete" label="Delete" onclick="deleteBudgetItem(' + item.id + ')"><span slot="icon">&#128465;&#65039;</span></np-button>' +
                    '</td>';
                tbody.appendChild(row);

                totalEstimate += item.estimate || 0;
                totalForecast += item.forecast || 0;
                totalSpend += item.total || 0;
            } catch (itemError) {
                console.warn('Skipping malformed budget item during render:', item, itemError);
            }
        });

        // Summary footer
        if (tfoot) {
            tfoot.innerHTML =
                '<tr>' +
                '<td></td>' +
                '<td><strong>Totals</strong></td>' +
                '<td><strong>' + formatCurrency(totalEstimate) + '</strong></td>' +
                '<td><strong>' + formatCurrency(totalForecast) + '</strong></td>' +
                '<td></td><td></td><td></td>' +
                '<td><strong>' + formatCurrency(totalSpend) + '</strong></td>' +
                '<td></td><td></td><td></td>' +
                '</tr>';
        }

        updateBudgetSortIndicators();
        updateBudgetMarkdownEditor();
    } catch (error) {
        console.error('Error rendering budget table:', error);
    }
}

function formatCurrency(value) {
    if (value === null || value === undefined || value === '' || value === 0) return '';
    return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sortBudgetTable(column) {
    if (budgetSortColumn === column) {
        budgetSortAsc = !budgetSortAsc;
    } else {
        budgetSortColumn = column;
        budgetSortAsc = true;
    }
    renderBudgetTable();
}

function updateBudgetSortIndicators() {
    const headers = document.querySelectorAll('.budget-table th');
    headers.forEach(th => {
        const indicator = th.querySelector('.sort-indicator');
        if (indicator) {
            const onclick = th.getAttribute('onclick');
            if (onclick && onclick.includes("'" + budgetSortColumn + "'")) {
                indicator.textContent = budgetSortAsc ? '\u25B2' : '\u25BC';
            } else {
                indicator.textContent = '';
            }
        }
    });
}

function generateBudgetMarkdown() {
    if (budgetItems.length === 0) return '# Budget\n\n*No items.*\n';

    const headers = ['ID', 'Description', 'Estimate', 'Forecast', 'Type', 'Invoice', 'PO', 'Supplier', 'Total', 'Ordered', 'Received', 'Category'];

    const escPipe = (text) => String(text || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

    const rows = budgetItems.map(item => [
        String(item.id),
        escPipe(item.description),
        String(item.estimate || 0),
        String(item.forecast || 0),
        escPipe(item.type),
        escPipe(item.invoice),
        escPipe(item.po),
        escPipe(item.supplier),
        String(item.total || 0),
        escPipe(item.date_ordered),
        escPipe(item.date_received),
        escPipe(item.category)
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

    let md = '# Budget\n\n';
    md += formatRow(headers) + '\n';
    md += separator + '\n';
    rows.forEach(row => {
        md += formatRow(row) + '\n';
    });

    return md;
}

function generateBudgetTable(items) {
    items = items || budgetItems;
    if (items.length === 0) return '';

    const headers = ['ID', 'Description', 'Estimate', 'Forecast', 'Type', 'Invoice', 'PO', 'Supplier', 'Total', 'Ordered', 'Received', 'Category'];
    const escPipe = (text) => String(text || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

    const rows = items.map(item => [
        String(item.id),
        escPipe(item.description),
        String(item.estimate || 0),
        String(item.forecast || 0),
        escPipe(item.type),
        escPipe(item.invoice),
        escPipe(item.po),
        escPipe(item.supplier),
        String(item.total || 0),
        escPipe(item.date_ordered),
        escPipe(item.date_received),
        escPipe(item.category)
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

    const lines = [formatRow(headers), separator];
    rows.forEach(row => lines.push(formatRow(row)));
    return lines.join('\n');
}

function parseBudgetMarkdown(text) {
    try {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        // Find header row containing budget-specific keywords
        let headerIndex = -1;
        const headerKeywords = ['id', 'description', 'estimate', 'forecast'];
        for (let i = 0; i < lines.length; i++) {
            const lower = lines[i].toLowerCase();
            if (lower.includes('|') && headerKeywords.some(kw => lower.includes(kw))) {
                headerIndex = i;
                break;
            }
        }

        if (headerIndex === -1) return [];

        const parseRow = (line) => {
            const parts = line.split(/(?<!\\)\|/).map(cell => cell.trim());
            return parts.filter((cell, idx, arr) => idx > 0 && idx < arr.length - 1 || (cell.length > 0 && idx > 0));
        };

        const headers = parseRow(lines[headerIndex]).map(h => h.toLowerCase());

        const colMap = {};
        const aliases = {
            'id': 'id', 'description': 'description', 'estimate': 'estimate',
            'forecast': 'forecast', 'type': 'type', 'invoice': 'invoice',
            'po': 'po', 'supplier': 'supplier', 'total': 'total',
            'ordered': 'date_ordered', 'received': 'date_received',
            'category': 'category'
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
        let maxIdSeen = 0;

        for (let i = headerIndex + 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line.includes('|')) continue;
            if (line.replace(/[|\-\s]/g, '').length === 0) continue;

            try {
                const cells = parseRow(line);
                if (cells.length === 0) continue;

                const getCell = (field, def) => {
                    const idx = colMap[field];
                    if (idx !== undefined && idx < cells.length) {
                        return cells[idx].replace(/\\\|/g, '|');
                    }
                    return def;
                };

                const idStr = getCell('id', '');
                let itemId;
                if (idStr) {
                    itemId = parseInt(idStr);
                    if (isNaN(itemId)) itemId = maxIdSeen + 1;
                } else {
                    itemId = maxIdSeen + 1;
                }
                maxIdSeen = Math.max(maxIdSeen, itemId);

                const itemType = getCell('type', 'Capex');
                const itemCategory = getCell('category', 'Consultancy');

                items.push({
                    id: itemId,
                    description: getCell('description', ''),
                    estimate: parseFloat(getCell('estimate', '0')) || 0,
                    forecast: parseFloat(getCell('forecast', '0')) || 0,
                    type: BUDGET_TYPES.includes(itemType) ? itemType : 'Capex',
                    invoice: getCell('invoice', ''),
                    po: getCell('po', ''),
                    supplier: getCell('supplier', ''),
                    total: parseFloat(getCell('total', '0')) || 0,
                    date_ordered: getCell('date_ordered', ''),
                    date_received: getCell('date_received', ''),
                    category: BUDGET_CATEGORIES.includes(itemCategory) ? itemCategory : 'Consultancy'
                });
            } catch (rowError) {
                console.warn('Skipping malformed budget row:', line, rowError);
                continue;
            }
        }

        return items;
    } catch (error) {
        console.error('Error parsing budget markdown:', error);
        return [];
    }
}

function extractBudgetFromPlanText(planText) {
    if (!planText) return '';
    const marker = BUDGET_START;
    const idx = planText.indexOf(marker);
    if (idx === -1) return '';
    const afterMarker = idx + marker.length;

    // Budget section ends at whichever other section marker occurs next
    // in the actual text, or EOF.
    let endIdx = planText.length;
    for (const other of ['---raid log---', COMMS_START, '---benefits---', LESSONS_START, BASELINE_START, WHITEBOARD_START]) {
        const oIdx = planText.indexOf(other, afterMarker);
        if (oIdx !== -1 && oIdx < endIdx) endIdx = oIdx;
    }
    return planText.substring(afterMarker, endIdx).trim();
}

function extractBudgetItemsFromPlanText(planText) {
    try {
        const budgetText = extractBudgetFromPlanText(planText);
        if (!budgetText) return [];
        return parseBudgetMarkdown(budgetText);
    } catch (error) {
        console.error('Error extracting budget items from plan text:', error);
        return [];
    }
}

function loadBudgetItemsFromData(items) {
    try {
        if (!items || items.length === 0) return;
        if (budgetItems.length > 0) return;

        budgetItems = items;
        budgetNextId = Math.max(...items.map(i => i.id || 0)) + 1;
        renderBudgetTable();
        updateReportBudgetWidget();
    } catch (error) {
        console.error('Error loading budget items:', error);
    }
}

function syncBudgetToPlanText() {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const planText = editor.value;
    const updatedText = updatePlanBudgetText(planText, budgetItems);

    if (updatedText !== planText) {
        setEditorValuePreservingCursor(editor, updatedText);
        const kanbanEditor = document.getElementById('kanbanPlanEditor');
        if (kanbanEditor) {
            kanbanEditor.value = updatedText;
        }
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

function updatePlanBudgetText(planText, items) {
    const HIGHLIGHTS_START = '---highlights---';
    const HIGHLIGHTS_END = '---end-highlights---';
    const BENEFITS_START = '---benefits---';
    const BASELINE_START = '---baseline---';

    // Helper: extract a section's content between its start marker and the
    // next section marker (or EOF).
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

    // Extract every trailing section so we can re-append them in canonical order
    const highlightsText = extractSection(planText, HIGHLIGHTS_START,
        [HIGHLIGHTS_END, BUDGET_START, BENEFITS_START, RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START]);
    const hasEndHighlights = planText.includes(HIGHLIGHTS_END);
    const benefitsText = extractSection(planText, BENEFITS_START,
        [RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START]);
    const raidText = extractSection(planText, RAID_LOG_START,
        [COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START]);
    const commsText = extractSection(planText, COMMS_START,
        [LESSONS_START, BASELINE_START, WHITEBOARD_START]);
    const lessonsText = extractSection(planText, LESSONS_START, [BASELINE_START, WHITEBOARD_START]);
    const baselineText = extractSection(planText, BASELINE_START, [WHITEBOARD_START]);
    const whiteboardText = extractSection(planText, WHITEBOARD_START, []);

    // Strip all special sections from base to get just tasks + front matter
    let base = planText;
    const sectionMarkers = [HIGHLIGHTS_START, BUDGET_START, BENEFITS_START, RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START];
    let earliestIdx = base.length;
    for (const marker of sectionMarkers) {
        const idx = base.indexOf(marker);
        if (idx !== -1 && idx < earliestIdx) earliestIdx = idx;
    }
    // Also check for the --- separator before highlights
    if (earliestIdx < base.length) {
        base = base.substring(0, earliestIdx);
    }
    base = base.replace(/\n+$/, '');

    // Remove trailing --- separator
    let lines = base.split('\n');
    while (lines.length > 0 && lines[lines.length - 1].trim() === '---') {
        lines.pop();
    }
    base = lines.join('\n').replace(/\n+$/, '');

    // Rebuild in canonical order: tasks, highlights, budget, benefits, raid, comms, lessons, baseline, whiteboard
    let result = base;

    // Re-append highlights
    if (highlightsText) {
        result = result + '\n\n---\n\n' + HIGHLIGHTS_START + '\n' + highlightsText;
        if (hasEndHighlights) {
            result = result.replace(/\n+$/, '') + '\n\n' + HIGHLIGHTS_END;
        }
    }

    // Build and append the budget section
    const table = generateBudgetTable();
    if (table) {
        result = result.replace(/\n+$/, '') + '\n\n' + BUDGET_START + '\n' + table;
    }

    // Re-append remaining sections
    if (benefitsText) {
        result = result.replace(/\n+$/, '') + '\n\n' + BENEFITS_START + '\n' + benefitsText;
    }
    if (raidText) {
        result = result.replace(/\n+$/, '') + '\n\n' + RAID_LOG_START + '\n' + raidText;
    }
    if (commsText) {
        result = result.replace(/\n+$/, '') + '\n\n' + COMMS_START + '\n' + commsText;
    }
    if (lessonsText) {
        result = result.replace(/\n+$/, '') + '\n\n' + LESSONS_START + '\n' + lessonsText;
    }
    if (baselineText) {
        result = result.replace(/\n+$/, '') + '\n\n' + BASELINE_START + '\n' + baselineText;
    }
    if (whiteboardText) {
        result = result.replace(/\n+$/, '') + '\n\n' + WHITEBOARD_START + '\n' + whiteboardText;
    }

    return result;
}

function updateReportBudgetWidget() {
    try {
        const widget = document.getElementById('reportBudgetWidget');
        if (!widget) return;

        if (budgetItems.length === 0) {
            widget.style.display = 'none';
            return;
        }

        widget.style.display = '';

        let totalForecast = 0;
        let totalSpend = 0;
        budgetItems.forEach(item => {
            totalForecast += item.forecast || 0;
            totalSpend += item.total || 0;
        });

        const remaining = totalForecast - totalSpend;
        const spendPercent = totalForecast > 0 ? (totalSpend / totalForecast) * 100 : 0;

        const forecastEl = document.getElementById('reportBudgetForecast');
        const spendEl = document.getElementById('reportBudgetSpend');
        const remainingEl = document.getElementById('reportBudgetRemaining');
        const barEl = document.getElementById('reportBudgetBar');

        if (forecastEl) forecastEl.textContent = formatCurrency(totalForecast);
        if (spendEl) spendEl.textContent = formatCurrency(totalSpend);
        if (remainingEl) {
            remainingEl.textContent = formatCurrency(remaining);
            remainingEl.className = 'budget-widget-value';
            if (remaining < 0) {
                remainingEl.classList.add('budget-over');
            } else if (spendPercent > 80) {
                remainingEl.classList.add('budget-warn');
            } else {
                remainingEl.classList.add('budget-under');
            }
        }

        if (barEl) {
            barEl.style.width = Math.min(100, spendPercent) + '%';
            barEl.className = 'budget-widget-bar';
            if (spendPercent > 100) {
                barEl.classList.add('budget-over');
            } else if (spendPercent > 80) {
                barEl.classList.add('budget-warn');
            }
        }
    } catch (error) {
        console.error('Error updating report budget widget:', error);
    }
}

function toggleBudgetEditor() {
    const body = document.getElementById('budgetEditorBody');
    const toggle = document.getElementById('budgetEditorToggle');
    const actions = document.getElementById('budgetEditorActions');

    if (body && toggle) {
        const isCollapsed = body.classList.contains('collapsed');
        if (isCollapsed) {
            body.classList.remove('collapsed');
            toggle.textContent = '\u25BC';
            if (actions) actions.style.display = '';
            updateBudgetMarkdownEditor();
        } else {
            body.classList.add('collapsed');
            toggle.textContent = '\u25B6';
            if (actions) actions.style.display = 'none';
        }
    }
}

function updateBudgetMarkdownEditor() {
    if (budgetEditorIsUpdating) return;

    const editor = document.getElementById('budgetMarkdownEditor');
    const body = document.getElementById('budgetEditorBody');
    if (!editor || !body || body.classList.contains('collapsed')) return;

    budgetEditorIsUpdating = true;
    editor.value = generateBudgetMarkdown();
    budgetEditorIsUpdating = false;
}

function onBudgetMarkdownEdit() {
    if (budgetEditorIsUpdating) return;

    clearTimeout(budgetEditorDebounceTimer);
    budgetEditorDebounceTimer = setTimeout(function() {
        const editor = document.getElementById('budgetMarkdownEditor');
        if (!editor) return;

        budgetEditorIsUpdating = true;
        const items = parseBudgetMarkdown(editor.value);
        if (items.length > 0) {
            budgetItems = items;
            budgetNextId = Math.max(...items.map(i => i.id)) + 1;
            renderBudgetTable();
            syncBudgetToPlanText();
            updateReportBudgetWidget();
        }
        editor.value = generateBudgetMarkdown();
        budgetEditorIsUpdating = false;
    }, 500);
}

// Wire up budget markdown editor input event
document.addEventListener('DOMContentLoaded', function() {
    const budgetEditor = document.getElementById('budgetMarkdownEditor');
    if (budgetEditor) {
        budgetEditor.addEventListener('input', onBudgetMarkdownEdit);
    }
});

/*
 * Budget Excel Export/Import
 */

async function exportBudgetExcel() {
    if (budgetItems.length === 0) {
        alert('No budget items to export. Add some items first.');
        return;
    }

    if (browserExcelExportsEnabled()) {
        try {
            const module = await import('/static/browser-excel.js');
            await module.exportBudgetExcelInBrowser(budgetItems, { projectName: 'Budget', filename: 'budget.xlsx' });
            return;
        } catch (error) {
            console.error('Browser budget export failed, falling back to backend:', error);
        }
    }

    try {
        const response = await fetch('/api/budget/export-excel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                items: budgetItems,
                project_name: 'Budget'
            })
        });

        if (!response.ok) {
            throw new Error('Export failed');
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'budget.xlsx';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    } catch (error) {
        alert('Failed to export to Excel: ' + error.message);
    }
}

async function uploadBudgetExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.xlsx')) {
        alert('Please select an Excel (.xlsx) file.');
        event.target.value = '';
        return;
    }

    if (browserExcelExportsEnabled()) {
        try {
            const module = await import('/static/browser-excel.js');
            const result = await module.importBudgetExcelInBrowser(file);
            if (result.items && result.items.length > 0) {
                budgetItems = result.items;
                budgetNextId = Math.max(...result.items.map(i => i.id)) + 1;
                renderBudgetTable();
                syncBudgetToPlanText();
                updateReportBudgetWidget();
                alert('Imported ' + result.items.length + ' budget items.');
            } else {
                alert('No budget items found in the file.');
            }
            event.target.value = '';
            return;
        } catch (error) {
            console.error('Browser budget import failed, falling back to backend:', error);
        }
    }

    try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/budget/import-excel', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Import failed');
        }

        const result = await response.json();
        if (result.items && result.items.length > 0) {
            budgetItems = result.items;
            budgetNextId = Math.max(...result.items.map(i => i.id)) + 1;
            renderBudgetTable();
            syncBudgetToPlanText();
            updateReportBudgetWidget();
            alert('Imported ' + result.items.length + ' budget items.');
        } else {
            alert('No budget items found in the file.');
        }
    } catch (error) {
        alert('Failed to import Excel: ' + error.message);
    }

    event.target.value = '';
}

function downloadBudgetMarkdown() {
    const content = generateBudgetMarkdown();

    if (budgetItems.length === 0) {
        alert('No budget items to download. Add some items first.');
        return;
    }

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'budget.md';
    document.body.appendChild(a);
    a.click();

    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

function uploadBudgetMarkdown(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.match(/\.(md|txt)$/i)) {
        alert('Please select a Markdown (.md) or text (.txt) file.');
        event.target.value = '';
        return;
    }

    file.text().then(text => {
        const items = parseBudgetMarkdown(text);
        if (items.length === 0) {
            alert('No budget items found in the file. Please check the format.');
        } else {
            budgetItems = items;
            budgetNextId = Math.max(...items.map(i => i.id)) + 1;
            renderBudgetTable();
            syncBudgetToPlanText();
            updateReportBudgetWidget();
        }
        event.target.value = '';
    });
}

function uploadBudgetMarkdownFromEditor() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.txt';
    input.onchange = function(event) {
        uploadBudgetMarkdown(event);
    };
    input.click();
}


// ── NoodleSheet Integration for Budget ────────────────────────────

// BUDGET_DBML is now in state.js

function toggleBudgetSheetView() {
    budgetSheetViewActive = !budgetSheetViewActive;

    const sheetContainer = document.getElementById('budgetSheetContainer');
    const tableWrapper = document.querySelector('.budget-table-wrapper');
    const emptyState = document.getElementById('budgetEmptyState');
    const toggleBtn = document.getElementById('budgetViewToggle');
    const filterGroups = document.querySelectorAll('.budget-filter-group');

    if (budgetSheetViewActive) {
        // Switch to spreadsheet view
        if (tableWrapper) tableWrapper.style.display = 'none';
        if (emptyState) emptyState.hidden = true;
        sheetContainer.style.display = 'flex';
        toggleBtn.classList.add('active');
        filterGroups.forEach(fg => fg.style.display = 'none');

        initBudgetSheet();
        syncBudgetItemsToSheet();
    } else {
        // Switch back to table view
        sheetContainer.style.display = 'none';
        if (tableWrapper) tableWrapper.style.display = '';
        toggleBtn.classList.remove('active');
        filterGroups.forEach(fg => fg.style.display = '');

        // Sync sheet data back to budget items
        syncSheetToBudgetItems();
        renderBudgetTable();
    }
}

function initBudgetSheet() {
    if (budgetSheetInstance) return;

    const container = document.getElementById('budgetSheetContainer');
    budgetSheetInstance = new NoodleSheet(container, {
        sheets: [{
            name: 'Budget',
            dbml: BUDGET_DBML,
            markdown: ''
        }],
        onChange: function(sheetIndex, markdown) {
            syncSheetToBudgetItems();
            syncBudgetToPlanText();
        }
    });

    // The spreadsheet view hides the toolbar's Category/Type filters, so
    // equivalent dropdowns live in the sheet's own column headers instead
    // (#1119). NoodleSheet rebuilds its header on every renderGrid() call
    // (sort, edit, loadMarkdown, ...), so wrap it rather than patch the
    // shared component -- our filters get re-added after every rebuild.
    const originalRenderGrid = budgetSheetInstance.renderGrid.bind(budgetSheetInstance);
    budgetSheetInstance.renderGrid = function() {
        originalRenderGrid();
        injectBudgetSheetHeaderFilters();
    };
    budgetSheetInstance.renderGrid();
}

// Does this budget item pass the spreadsheet view's header filters? Used
// both to build the filtered rows shown in the sheet and, on the way back,
// to keep hold of the items the current filters are hiding.
function budgetItemMatchesSheetFilters(item) {
    if (budgetSheetCategoryFilter !== 'all' && item.category !== budgetSheetCategoryFilter) return false;
    if (budgetSheetTypeFilter !== 'all' && item.type !== budgetSheetTypeFilter) return false;
    return true;
}

// Adds small <select> filters into the Category/Type column header cells of
// the budget NoodleSheet grid, cloned from the toolbar's own
// #budgetCategoryFilter/#budgetTypeFilter selects so both views offer the
// exact same option values (#1119).
function injectBudgetSheetHeaderFilters() {
    const container = document.getElementById('budgetSheetContainer');
    if (!container) return;

    const filterConfig = [
        { label: 'category', sourceId: 'budgetCategoryFilter', get: () => budgetSheetCategoryFilter, set: (v) => { budgetSheetCategoryFilter = v; } },
        { label: 'type', sourceId: 'budgetTypeFilter', get: () => budgetSheetTypeFilter, set: (v) => { budgetSheetTypeFilter = v; } }
    ];

    container.querySelectorAll('.ns-col-header').forEach(th => {
        const nameEl = th.querySelector('.ns-col-name');
        if (!nameEl) return;
        const label = (nameEl.firstChild ? nameEl.firstChild.textContent : nameEl.textContent || '').trim().toLowerCase();
        const config = filterConfig.find(c => c.label === label);
        if (!config) return;

        const sourceSelect = document.getElementById(config.sourceId);
        if (!sourceSelect) return;

        const select = sourceSelect.cloneNode(true);
        select.removeAttribute('id');
        select.removeAttribute('onchange');
        select.className = 'budget-sheet-col-filter';
        select.value = config.get();
        select.title = 'Filter rows by ' + label;
        select.setAttribute('aria-label', 'Filter rows by ' + label);
        // Keep clicks/drags on the filter from also triggering the header's
        // own sort-on-click and column-resize handlers.
        ['click', 'mousedown', 'pointerdown'].forEach(evt => {
            select.addEventListener(evt, (e) => e.stopPropagation());
        });
        select.addEventListener('change', (e) => {
            e.stopPropagation();
            config.set(select.value);
            syncBudgetItemsToSheet();
        });
        th.appendChild(select);
    });
}

function syncBudgetItemsToSheet() {
    if (!budgetSheetInstance) return;

    const filtered = budgetItems.filter(budgetItemMatchesSheetFilters);
    const md = generateBudgetTable(filtered);
    budgetSheetInstance.loadMarkdown(md, 0);
}

function syncSheetToBudgetItems() {
    if (!budgetSheetInstance) return;

    const rows = budgetSheetInstance.getRows(0);
    const columns = budgetSheetInstance.getColumns(0);
    if (!columns.length) return;

    const visibleItems = rows.filter(row => {
        return columns.some(col => row[col.name] && row[col.name].trim() !== '');
    }).map(row => ({
        description: row.description || '',
        estimate: row.estimate || '',
        forecast: row.forecast || '',
        type: row.type || '',
        invoice_number: row.invoice_number || '',
        po_number: row.po_number || '',
        supplier: row.supplier || '',
        total: row.total || '',
        date_ordered: row.date_ordered || '',
        date_received: row.date_received || '',
        category: row.category || ''
    }));

    // The sheet only ever shows the rows that pass the header filters, so a
    // straight replace would silently delete everything currently filtered
    // out. Keep those items untouched and merge the (possibly edited)
    // visible rows back in alongside them.
    const hiddenItems = budgetItems.filter(item => !budgetItemMatchesSheetFilters(item));

    const merged = hiddenItems.concat(visibleItems);
    budgetItems = merged.map((item, i) => Object.assign({}, item, { id: i + 1 }));
    budgetNextId = budgetItems.length + 1;
}


/*
 * RAID Log Plan Sync
 * Persists RAID items as a markdown table at the bottom of the plan text.
 */

// RAID_LOG_START is now in state.js

/**
 * Generate a markdown table for the RAID log with auto-sized columns.
 * Each column is padded to the width of its widest entry.
 */
function generateRaidLogTable() {
    if (raidItems.length === 0) return '';

    let headers = ['ID', 'Type', 'Title', 'Description', 'Raised By', 'Owner', 'Mitigation Actions', 'Impact', 'Likelihood', 'Score', 'Status'];
    const escPipe = (text) => String(text || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

    const includeEscalation = raidItems.some(item => item.escalated || (item.escalation_level && item.escalation_level !== 'project'));
    if (includeEscalation) headers = headers.concat(['Escalated', 'Escalation Level']);

    const rows = raidItems.map(item => {
        const row = [
            String(item.id),
            escPipe(item.type),
            escPipe(item.title),
            escPipe(item.description),
            escPipe(item.raised_by),
            escPipe(item.owner),
            escPipe(item.mitigation_actions),
            String(item.impact),
            String(item.likelihood),
            String(item.score),
            escPipe(item.status)
        ];
        if (includeEscalation) {
            row.push(item.escalated ? 'yes' : 'no');
            row.push(item.escalation_level || 'project');
        }
        return row;
    });

    // Calculate column widths
    const widths = headers.map(h => h.length);
    rows.forEach(row => {
        row.forEach((cell, i) => {
            widths[i] = Math.max(widths[i], cell.length);
        });
    });

    const pad = (str, width) => str + ' '.repeat(Math.max(0, width - str.length));

    const formatRow = (cells) => '| ' + cells.map((c, i) => pad(c, widths[i])).join(' | ') + ' |';
    const separator = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';

    const lines = [formatRow(headers), separator];
    rows.forEach(row => lines.push(formatRow(row)));
    return lines.join('\n');
}

/**
 * Sync RAID log data into the plan editor text.
 * Generates the RAID log markdown table and updates the plan text,
 * placing it after the highlights section.
 */
function syncRaidLogToPlanText() {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const planText = editor.value;
    const updatedText = updatePlanRaidLogText(planText, raidItems);

    if (updatedText !== planText) {
        setEditorValuePreservingCursor(editor, updatedText);
        const kanbanEditor = document.getElementById('kanbanPlanEditor');
        if (kanbanEditor) {
            kanbanEditor.value = updatedText;
        }
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

/**
 * Update plan text with RAID log section.
 * JavaScript equivalent of the Python update_plan_raid_log function.
 */
function updatePlanRaidLogText(planText, items) {
    const HIGHLIGHTS_START = '---highlights---';
    const HIGHLIGHTS_END = '---end-highlights---';
    const BENEFITS_START_M = '---benefits---';

    // Helper: extract a section's content between its start marker and the
    // next section marker (or EOF).
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
        [HIGHLIGHTS_END, BUDGET_START, BENEFITS_START_M, RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START]);
    const hasEndHighlights = planText.includes(HIGHLIGHTS_END);
    const budgetText = extractSection(planText, BUDGET_START,
        [BENEFITS_START_M, RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START]);
    const benefitsText = extractSection(planText, BENEFITS_START_M,
        [RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START]);
    const commsText = extractSection(planText, COMMS_START, [LESSONS_START, BASELINE_START, WHITEBOARD_START]);
    const lessonsText = extractSection(planText, LESSONS_START, [BASELINE_START, WHITEBOARD_START]);
    const baselineText = extractSection(planText, BASELINE_START, [WHITEBOARD_START]);
    const whiteboardText = extractSection(planText, WHITEBOARD_START, []);

    // Strip all special sections to get just tasks + front matter
    let base = planText;
    const sectionMarkers = [HIGHLIGHTS_START, BUDGET_START, BENEFITS_START_M, RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START];
    let earliestIdx = base.length;
    for (const marker of sectionMarkers) {
        const idx = base.indexOf(marker);
        if (idx !== -1 && idx < earliestIdx) earliestIdx = idx;
    }
    if (earliestIdx < base.length) {
        base = base.substring(0, earliestIdx);
    }
    base = base.replace(/\n+$/, '');

    // Remove trailing --- separator
    let lines = base.split('\n');
    while (lines.length > 0 && lines[lines.length - 1].trim() === '---') {
        lines.pop();
    }
    base = lines.join('\n').replace(/\n+$/, '');

    // Rebuild in canonical order: tasks, highlights, budget, benefits, raid, comms, lessons, baseline, whiteboard
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
    if (benefitsText) {
        result = result.replace(/\n+$/, '') + '\n\n' + BENEFITS_START_M + '\n' + benefitsText;
    }

    const table = generateRaidLogTable();
    if (table) {
        result = result.replace(/\n+$/, '') + '\n\n' + RAID_LOG_START + '\n' + table;
    }

    if (commsText) {
        result = result.replace(/\n+$/, '') + '\n\n' + COMMS_START + '\n' + commsText;
    }
    if (lessonsText) {
        result = result.replace(/\n+$/, '') + '\n\n' + LESSONS_START + '\n' + lessonsText;
    }
    if (baselineText) {
        result = result.replace(/\n+$/, '') + '\n\n' + BASELINE_START + '\n' + baselineText;
    }
    if (whiteboardText) {
        result = result.replace(/\n+$/, '') + '\n\n' + WHITEBOARD_START + '\n' + whiteboardText;
    }

    return result;
}


/**
 * Show a brief toast notification at the top of the screen.
 */
function showToast(message, type) {
    const toast = document.createElement('div');
    toast.className = 'baseline-toast baseline-toast-' + (type || 'info');
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => { toast.classList.add('show'); });

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}


/**
 * Baseline Plan System (issue #1112)
 * Stores a snapshot of the current schedule as a baseline for comparison.
 * Only one baseline's task-level data is ever kept -- the *active* one --
 * stored as a ---baseline--- section at the bottom of the plan text with a
 * markdown table (name/start/finish/duration per task), same as before
 * #1112. Layered on top of that table is a lightweight history log (id,
 * name, creation date -- no task data) recording every baseline the
 * Baseline dialog has created, so a user can see past baselines and delete
 * them even after they've been replaced or cleared. See
 * format_converter.py's generate_baseline_history_comment() for the exact
 * on-disk format and why it's a comment line rather than a second table.
 */

// Baseline state (baselineItems, baselineHistory, activeBaselineId) is in
// state.js.

/**
 * Format a Date for a default baseline name / list display, e.g.
 * "12 Sep 2026, 14:05".
 */
function formatBaselineTimestamp(date) {
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
        + ', ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Create a new baseline from the current scheduled tasks: captures name,
 * start, finish, and duration for each task, makes it the active baseline,
 * and records it in the history log. Used by both the Baseline dialog and
 * the Gantt toolbar's quick "Set Baseline" button.
 *
 * @param {string} [name] Label for this baseline; defaults to a timestamp.
 * @returns {boolean} true if a baseline was created.
 */
function createBaseline(name) {
    if (!lastRenderedTasks || lastRenderedTasks.length === 0) {
        showToast('No tasks to baseline. Render your plan first.', 'warning');
        return false;
    }

    const label = (name && name.trim()) || ('Baseline ' + formatBaselineTimestamp(new Date()));

    baselineItems = lastRenderedTasks
        .filter(t => t.start && t.finish)
        .map(t => ({
            name: t.name,
            start: t.start,
            finish: t.finish,
            duration: t.duration_days != null ? t.duration_days + 'd' : ''
        }));

    const id = 'bl-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    activeBaselineId = id;
    baselineHistory = [{ id, name: label, date: new Date().toISOString() }, ...baselineHistory];

    syncBaselineToPlanText();
    showBaselineToggle(true);
    showToast('Baseline "' + label + '" created.', 'success');

    // Re-render views if baseline is visible
    const ganttToggle = document.getElementById('ganttShowBaseline');
    if (ganttToggle && ganttToggle.checked) {
        renderGanttChart();
    }
    const msToggle = document.getElementById('milestonesShowBaseline');
    if (msToggle && msToggle.checked) {
        updateMilestonesTable(lastRenderedTasks);
    }
    return true;
}

/**
 * Clear the active baseline (stop comparing against it) without deleting
 * its entry from the history log -- it stays listed in the Baseline
 * dialog, just no longer "Active", and can still be deleted from there.
 */
function clearActiveBaseline() {
    baselineItems = [];
    activeBaselineId = null;
    syncBaselineToPlanText();
    showBaselineToggle(false);

    renderGanttChart();
    updateMilestonesTable(lastRenderedTasks || []);
}

/**
 * Permanently remove one baseline from the history log. If it was the
 * active baseline, this also clears the active table (its task-level data
 * only ever existed there, so there is nothing left to keep active).
 */
function deleteBaselineEntry(id) {
    const wasActive = id === activeBaselineId;
    baselineHistory = baselineHistory.filter(entry => entry.id !== id);

    if (wasActive) {
        baselineItems = [];
        activeBaselineId = null;
        showBaselineToggle(false);
        renderGanttChart();
        updateMilestonesTable(lastRenderedTasks || []);
    }

    syncBaselineToPlanText();
}

/**
 * Set (or replace) the baseline from the current scheduled tasks.
 * Legacy one-click entry point (the Gantt toolbar's "Set Baseline"
 * button) -- kept alongside the fuller Baseline dialog (openBaselineDialog)
 * for the "just snapshot it now" flow it always offered, now backed by the
 * same createBaseline() the dialog uses.
 */
function setBaseline() {
    if (!lastRenderedTasks || lastRenderedTasks.length === 0) {
        showToast('No tasks to baseline. Render your plan first.', 'warning');
        return;
    }

    const hasExisting = baselineItems.length > 0;
    const message = hasExisting
        ? 'Replace the existing baseline with the current schedule?'
        : 'Set the current schedule as the baseline?';

    if (!confirm(message)) return;

    createBaseline();
}

/**
 * Clear the active baseline from the plan (legacy entry point -- see
 * clearActiveBaseline() for what actually happens).
 */
function clearBaseline() {
    if (!confirm('Remove the current baseline from this plan? Past baselines stay listed in the Baseline dialog.')) return;
    clearActiveBaseline();
    showToast('Baseline cleared.', 'success');
}

/**
 * Show or hide the baseline toggle controls in Gantt and Milestones views.
 */
function showBaselineToggle(show) {
    const ganttLabel = document.getElementById('baselineToggleLabel');
    const msLabel = document.getElementById('milestonesBaselineToggleLabel');
    if (ganttLabel) ganttLabel.style.display = show ? '' : 'none';
    if (msLabel) msLabel.style.display = show ? '' : 'none';
}

/**
 * Toggle baseline display in the Gantt chart.
 */
function toggleBaselineDisplay() {
    renderGanttChart();
    const toggle = document.getElementById('ganttShowBaseline');
    if (toggle && typeof syncToolbarToSettings === 'function') {
        syncToolbarToSettings('gantt_baseline', toggle.checked);
    }
}

/**
 * Toggle baseline display in the Milestones table.
 */
function toggleMilestonesBaselineDisplay() {
    updateMilestonesTable(lastRenderedTasks || []);
}

/**
 * Load baseline items from the API response or plan text.
 */
function loadBaselineFromData(items) {
    if (!items || items.length === 0) {
        baselineItems = [];
        showBaselineToggle(false);
        return;
    }
    baselineItems = items;
    showBaselineToggle(true);
}

/**
 * Extract the raw text of the ---baseline--- section (the #1112 history
 * comment, if any, plus the active baseline's markdown table), without
 * parsing it. Shared by extractBaselineFromPlanText() (items) and
 * updateBaselineView() (history) so the section boundary logic -- baseline
 * is not always the last section, a whiteboard section may follow it --
 * lives in exactly one place.
 */
function extractBaselineSectionText(planText) {
    const marker = BASELINE_START;
    const idx = planText.indexOf(marker);
    if (idx === -1) return '';

    const afterStart = idx + marker.length;
    let endIdx = planText.length;
    for (const other of [WHITEBOARD_START]) {
        const oi = planText.indexOf(other, afterStart);
        if (oi !== -1 && oi < endIdx) endIdx = oi;
    }

    return planText.substring(afterStart, endIdx).trim();
}

/**
 * Extract baseline items from plan text (client-side fallback).
 */
function extractBaselineFromPlanText(planText) {
    const section = extractBaselineSectionText(planText);
    if (!section) return [];
    return parseBaselineMarkdown(section);
}

/**
 * Build the <!-- baseline-history: ... --> comment line that records the
 * baseline history log (#1112). Mirrors format_converter.py's
 * generate_baseline_history_comment() -- keep the two in sync.
 */
function generateBaselineHistoryComment(activeId, entries) {
    if (!entries || entries.length === 0) return '';
    const payload = JSON.stringify({ active: activeId || null, entries: entries });
    return '<!-- baseline-history: ' + payload + ' -->';
}

/**
 * Parse the baseline-history comment out of a ---baseline--- section's raw
 * text (extractBaselineSectionText()'s return value). Mirrors
 * format_converter.py's extract_baseline_history() -- keep the two in sync.
 * Defaults to { active: null, entries: [] } for plans with no history
 * comment (pre-#1112 plans, or a section that's just the plain table).
 */
function extractBaselineHistoryFromSectionText(sectionText) {
    const empty = { active: null, entries: [] };
    if (!sectionText) return empty;

    const m = sectionText.match(/<!--\s*baseline-history:\s*(\{[\s\S]*?\})\s*-->/);
    if (!m) return empty;

    try {
        const data = JSON.parse(m[1]);
        if (!data || typeof data !== 'object') return empty;
        const entries = Array.isArray(data.entries) ? data.entries : [];
        const active = typeof data.active === 'string' ? data.active : null;
        return { active, entries };
    } catch (e) {
        return empty;
    }
}

/**
 * Parse a baseline markdown table into an array of items.
 */
function parseBaselineMarkdown(text) {
    const items = [];
    const lines = text.trim().split('\n');

    // Find header row
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('|') && lines[i].toLowerCase().includes('task name')) {
            headerIdx = i;
            break;
        }
    }
    if (headerIdx === -1) return items;

    // Parse headers
    const headers = lines[headerIdx].replace(/^\||\|$/g, '').split('|').map(h => h.trim().toLowerCase());

    // Data rows start after separator
    const dataStart = headerIdx + 2;

    for (let i = dataStart; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || !line.startsWith('|')) continue;

        const cells = line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        if (cells.length < headers.length) continue;

        const item = {};
        headers.forEach((h, idx) => {
            const val = cells[idx] || '';
            if (h === 'task name') item.name = val;
            else if (h === 'start') item.start = val;
            else if (h === 'finish') item.finish = val;
            else if (h === 'duration') item.duration = val;
        });

        if (item.name) items.push(item);
    }

    return items;
}

/**
 * Generate a markdown table from baseline items.
 */
function generateBaselineTable() {
    if (baselineItems.length === 0) return '';

    const headers = ['Task Name', 'Start', 'Finish', 'Duration'];
    const rows = baselineItems.map(item => [
        String(item.name || ''),
        String(item.start || ''),
        String(item.finish || ''),
        String(item.duration || '')
    ]);

    // Calculate column widths
    const widths = headers.map(h => h.length);
    rows.forEach(row => {
        row.forEach((cell, i) => {
            widths[i] = Math.max(widths[i], cell.length);
        });
    });

    const pad = (str, width) => str + ' '.repeat(Math.max(0, width - str.length));
    const formatRow = (cells) => '| ' + cells.map((c, i) => pad(c, widths[i])).join(' | ') + ' |';
    const separator = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';

    const lines = [formatRow(headers), separator];
    rows.forEach(row => lines.push(formatRow(row)));
    return lines.join('\n');
}

/**
 * Sync baseline data into the plan editor text.
 */
function syncBaselineToPlanText() {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const planText = editor.value;
    const updatedText = updatePlanBaselineText(planText, baselineItems);

    if (updatedText !== planText) {
        setEditorValuePreservingCursor(editor, updatedText);
        const kanbanEditor = document.getElementById('kanbanPlanEditor');
        if (kanbanEditor) {
            kanbanEditor.value = updatedText;
        }
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

/**
 * Update plan text with baseline section.
 */
function updatePlanBaselineText(planText, items) {
    // Preserve the whiteboard section, which is canonically last (after
    // baseline) but must survive being edited via the baseline view.
    let whiteboardText = '';
    const wbIdx = planText.indexOf(WHITEBOARD_START);
    if (wbIdx !== -1) {
        whiteboardText = planText.substring(wbIdx + WHITEBOARD_START.length).replace(/^\n+/, '').replace(/\n+$/, '');
    }

    // Strip existing baseline section, stopping at whichever marker
    // (whiteboard, or EOF) actually follows it in the text.
    let base = planText;
    const startIdx = base.indexOf(BASELINE_START);
    if (startIdx !== -1) {
        let endIdx = base.length;
        if (wbIdx !== -1 && wbIdx > startIdx) endIdx = wbIdx;
        base = (base.substring(0, startIdx) + base.substring(endIdx)).replace(/\n+$/, '');
    } else if (wbIdx !== -1) {
        base = base.substring(0, wbIdx).replace(/\n+$/, '');
    }
    base = base.replace(/\n+$/, '');

    const table = generateBaselineTable();
    // #1112: the history log rides along as a comment line above the table
    // (or alone, once the active baseline has been cleared but past
    // baselines are still listed in the dialog) -- see
    // generateBaselineHistoryComment()'s header comment for why.
    const historyComment = generateBaselineHistoryComment(activeBaselineId, baselineHistory);
    const sectionText = [historyComment, table].filter(Boolean).join('\n\n');
    let result = base;
    if (sectionText) {
        result = result + '\n\n' + BASELINE_START + '\n' + sectionText;
    }

    if (whiteboardText) {
        result = result.replace(/\n+$/, '') + '\n\n' + WHITEBOARD_START + '\n' + whiteboardText;
    }

    return result;
}

// ---------------------------------------------------------------------------
// Baseline dialog (issue #1112)
//
// Opened from the Plan ribbon's Baseline button (and Gantt Tools' own
// Baseline button, which shares the same generic ribbon action) instead of
// the old "just toggle the Gantt display checkbox" behaviour. Lets the user
// create a new baseline, see every baseline previously created on this
// plan, clear the active one (stop comparing against it, keep it listed),
// and delete a past one outright.
// ---------------------------------------------------------------------------

/**
 * Open the Baseline dialog and render its current list.
 */
function openBaselineDialog() {
    const overlay = document.getElementById('baselineDialogOverlay');
    if (!overlay) return;
    const nameInput = document.getElementById('newBaselineName');
    if (nameInput) nameInput.value = '';
    renderBaselineDialogList();
    overlay.classList.add('active');
}

/**
 * Close the Baseline dialog.
 */
function closeBaselineDialog() {
    const overlay = document.getElementById('baselineDialogOverlay');
    if (overlay) overlay.classList.remove('active');
}

/**
 * Render the list of baselines (history entries) inside the dialog, most
 * recently created first -- baselineHistory is already kept in that order.
 */
function renderBaselineDialogList() {
    const list = document.getElementById('baselineHistoryList');
    if (!list) return;

    if (!baselineHistory || baselineHistory.length === 0) {
        list.innerHTML = '<p class="baseline-dialog-empty">No baselines yet. Create one above to start tracking schedule variance.</p>';
        return;
    }

    list.innerHTML = baselineHistory.map(entry => {
        const isActive = entry.id === activeBaselineId;
        const dateStr = formatBaselineTimestamp(new Date(entry.date));
        const safeName = escapeHtml(entry.name || 'Untitled baseline');
        const clearBtn = isActive
            ? `<button type="button" class="btn-secondary baseline-clear-btn" onclick="clearActiveBaselineFromDialog()">Clear</button>`
            : '';
        return `
            <div class="baseline-history-row${isActive ? ' baseline-history-row-active' : ''}">
                <div class="baseline-history-info">
                    <span class="baseline-history-name">${safeName}</span>
                    ${isActive ? '<span class="baseline-active-badge">Active</span>' : ''}
                    <span class="baseline-history-date">${dateStr}</span>
                </div>
                <div class="baseline-history-actions">
                    ${clearBtn}
                    <button type="button" class="btn-danger baseline-delete-btn" onclick="deleteBaselineEntryFromDialog('${entry.id}')" aria-label="Delete ${safeName}">&#128465; Delete</button>
                </div>
            </div>`;
    }).join('');
}

/**
 * Dialog "Create Baseline" button: read the name field and create a new
 * baseline from it.
 */
function createBaselineFromDialog() {
    const nameInput = document.getElementById('newBaselineName');
    const name = nameInput ? nameInput.value : '';
    if (!createBaseline(name)) return;
    if (nameInput) nameInput.value = '';
    renderBaselineDialogList();
}

/**
 * Dialog "Clear" button on the active baseline's row.
 */
function clearActiveBaselineFromDialog() {
    if (!confirm('Clear the active baseline? It stays listed here and can still be deleted, but the plan will no longer compare against it.')) return;
    clearActiveBaseline();
    showToast('Baseline cleared.', 'success');
    renderBaselineDialogList();
}

/**
 * Dialog "Delete" button on a baseline row.
 */
function deleteBaselineEntryFromDialog(id) {
    const entry = baselineHistory.find(e => e.id === id);
    const label = entry ? entry.name : 'this baseline';
    if (!confirm('Delete "' + label + '"? This cannot be undone.')) return;
    deleteBaselineEntry(id);
    showToast('Baseline deleted.', 'success');
    renderBaselineDialogList();
}

// =====================================================================
// Whiteboard back matter (issue #844)
//
// Storage-format only: no canvas, no notes, no rendering here. A future
// whiteboard view (#845 and siblings) will read/write through these
// helpers. The section is round-tripped using the marker
// ---whiteboard--- followed by a table with columns:
//
//   Task | X | Y | Colour | Width | Height | Collapsed
//
// matched by name, not position -- see docs/reference/plan-format.rst.
// This mirrors the JS-side convention already used by
// parseThemeColours()/saveThemeColours() (kanban.js) for a read/write
// helper pair, and the Python-side parse_whiteboard_markdown /
// generate_whiteboard_text pair in format_converter.py.
//
// Free-floating text objects (issue #1018): a *second* row shape sharing
// this exact same table, discriminated by three more columns -- Kind | Id
// | Text -- rather than a second section or a sentinel Task value. Why a
// second row shape in the same table rather than a cleanly-separated
// second ---whiteboard-text--- section (the issue's other suggested
// option): every existing whiteboard mutation (drag, resize, colour pick,
// add/remove note, rename, delete...) already works by reading the whole
// table into `items`, mutating it, and calling
// updatePlanWhiteboardText(planText, items) to rewrite the *entire*
// section from `items` alone (see whiteboard-notes.js's
// wbCommitNoteChange() and friends) -- a second, separately-parsed section
// nested in the same ---whiteboard--- block would be silently destroyed
// the next time a user so much as dragged an unrelated post-it, since
// nothing about that rewrite path knows the second section exists. Folding
// text objects into the same `items` array/table sidesteps that entirely:
// one parse, one rewrite, one section, no coupling to fix.
//
// A text-object row has no Task (it isn't backed by a task -- see this
// issue's own framing: "position + text content only, no other post-it
// fields") and none of a post-it's fields (Colour/Width/Height/Collapsed
// don't apply to bare text); it uses:
//
//   Kind: the literal string "text" (blank/absent means "post-it", the
//         pre-existing row shape, unchanged).
//   Id:   an opaque, generated identifier (e.g. "t1a2b3c4") standing in
//         for the Task column's role as the row's unique key, since a
//         text object has no task name to key off.
//   Text: the object's own text content, escaped so embedded pipes and
//         newlines survive the single-line table-cell format (own
//         escaping from the other columns' since Text, unlike Task/
//         Colour, is expected to hold real user prose -- see
//         generateWhiteboardText()'s escapeTextCell()).
//
// parseWhiteboardMarkdown() returns a text-object row as
// `{ kind: 'text', id, text, x, y }` -- deliberately a different, smaller
// shape than a post-it row's `{ task, x, y, colour, width, height,
// collapsed }`, with no `kind`/`id`/`text` keys present at all on a
// post-it row (rather than e.g. `kind: 'note'` on every row), so parsing
// an old plan with no text objects produces byte-for-byte the same item
// shape as before this issue -- see tests/test_whiteboard_backmatter.mjs.
// generateWhiteboardText() only emits the Kind/Id/Text columns at all when
// at least one item actually has kind 'text', so a plan with only post-it
// rows still round-trips through an edit with the exact same seven-column
// table it always has.
// =====================================================================

/**
 * Extract the raw ---whiteboard--- section text from plan text, or ''
 * if there isn't one.
 */
function extractWhiteboardFromPlanText(planText) {
    if (!planText) return '';
    const startIdx = planText.indexOf(WHITEBOARD_START);
    if (startIdx === -1) return '';
    const afterStart = startIdx + WHITEBOARD_START.length;

    // Whiteboard is canonically the second-to-last back-matter section
    // (parking lot, issue #1019, follows it) -- scan for every other
    // marker, not just the ones that used to come after it, so a parking
    // lot section is never swallowed into "whiteboard text".
    let endIdx = planText.length;
    for (const marker of [HIGHLIGHTS_START, HIGHLIGHTS_END, BUDGET_START, BENEFITS_START,
                          RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START,
                          PARKING_LOT_START]) {
        const mIdx = planText.indexOf(marker, afterStart);
        if (mIdx !== -1 && mIdx < endIdx) endIdx = mIdx;
    }

    return planText.substring(afterStart, endIdx).trim();
}

/**
 * Parse a whiteboard markdown table into an array of note objects.
 *
 * Columns are matched by name, not position: Task | X | Y | Colour |
 * Width | Height | Collapsed in any order, extra columns tolerated and
 * ignored. Nothing is ever dropped: an orphan row (Task matches no
 * summary task) or a duplicate Task is still returned as-is -- use
 * validateWhiteboardRows() for warnings about those. width/height are
 * null when the column is empty or absent ("use the default note size").
 */
function parseWhiteboardMarkdown(text) {
    if (!text) return [];
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);

    function parseRow(line) {
        let parts = line.split(/(?<!\\)\|/);
        if (parts.length && !parts[0].trim()) parts = parts.slice(1);
        if (parts.length && !parts[parts.length - 1].trim()) parts = parts.slice(0, -1);
        return parts.map(c => c.trim());
    }

    let headerIndex = -1;
    let headers = [];
    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes('|')) continue;
        const cells = parseRow(lines[i]).map(c => c.toLowerCase());
        if (cells.includes('task')) {
            headerIndex = i;
            headers = cells;
            break;
        }
    }
    if (headerIndex === -1) return [];

    const aliases = {
        task: 'task', x: 'x', y: 'y', colour: 'colour', color: 'colour',
        width: 'width', height: 'height', collapsed: 'collapsed',
        // Issue #1018: free-floating text object columns -- see this
        // file's "Whiteboard back matter" header comment above.
        kind: 'kind', id: 'id', text: 'text',
    };
    const colMap = {};
    headers.forEach((h, idx) => {
        if (aliases[h] && !(aliases[h] in colMap)) colMap[aliases[h]] = idx;
    });

    function safeInt(val, fallback) {
        const n = parseInt(val, 10);
        return Number.isNaN(n) ? fallback : n;
    }

    const items = [];
    for (let i = headerIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes('|')) continue;
        if (line.replace(/[|\- ]/g, '') === '') continue; // separator row
        if (line.startsWith('//')) continue;

        const cells = parseRow(line);
        if (!cells.length) continue;

        function getCell(field, fallback) {
            const idx = colMap[field];
            if (idx !== undefined && idx < cells.length) return cells[idx].replace(/\\\|/g, '|');
            return fallback !== undefined ? fallback : '';
        }

        // Issue #1018: a free-floating text object row -- discriminated by
        // Kind="text" rather than by an empty Task (Task is meaningless
        // for a row with no backing task at all). Id stands in for Task's
        // role as this row's unique key; a text row with no Id can't be
        // reliably tracked (drag/edit/delete all key off it), so it's
        // dropped, matching the existing "no Task, no row" rule for
        // post-its just below. Returns a deliberately different, smaller
        // shape than a post-it row -- see this file's header comment.
        const kindStr = getCell('kind', '').trim().toLowerCase();

        // Issue #874: a group boundary. Keyed by Task like a post-it,
        // because a group *is* a summary task -- the row exists only to say
        // "draw this task as a boundary round its children rather than as a
        // post-it", which is the one thing the outline cannot say on its own.
        //
        // No geometry is read back. A boundary is the box its members
        // occupy, so storing a rect would be a second source of truth that
        // could disagree with them; the X/Y/Width/Height cells are written
        // from the derived box each time the table is rewritten, so the
        // markdown still reads sensibly on its own, and are ignored here.
        if (kindStr === 'group') {
            const groupTask = getCell('task', '');
            if (!groupTask) continue;
            items.push({ kind: 'group', task: groupTask, colour: getCell('colour', '') });
            continue;
        }

        if (kindStr === 'text') {
            const idStr = getCell('id', '').trim();
            if (!idStr) continue;
            items.push({
                kind: 'text',
                id: idStr,
                text: getCell('text', '').replace(/\\n/g, '\n'),
                x: safeInt(getCell('x', '0'), 0),
                y: safeInt(getCell('y', '0'), 0),
            });
            continue;
        }

        const taskName = getCell('task', '');
        if (!taskName) continue;

        const widthStr = getCell('width', '').trim();
        const heightStr = getCell('height', '').trim();
        const collapsedStr = getCell('collapsed', '').trim().toLowerCase();

        items.push({
            task: taskName,
            x: safeInt(getCell('x', '0'), 0),
            y: safeInt(getCell('y', '0'), 0),
            colour: getCell('colour', ''),
            width: widthStr ? safeInt(widthStr, null) : null,
            height: heightStr ? safeInt(heightStr, null) : null,
            collapsed: ['yes', 'true', '1'].includes(collapsedStr),
        });
    }
    return items;
}

/**
 * Generate a formatted markdown table from whiteboard note items,
 * columns padded to their widest entry (matching the other back-matter
 * generators). Returns '' if there are no items.
 */
function generateWhiteboardText(items) {
    if (!items || items.length === 0) return '';
    const headers = ['Task', 'X', 'Y', 'Colour', 'Width', 'Height', 'Collapsed'];

    const escapePipe = (value) => String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const cellOrBlank = (value) => (value === null || value === undefined || value === '') ? '' : String(value);

    // Issue #1018: newlines in a text object's own content are meaningful
    // (a heading can wrap), unlike every other column here, so this cell
    // gets its own escaping that round-trips a literal newline instead of
    // flattening it to a space -- see parseWhiteboardMarkdown()'s matching
    // unescape (`.replace(/\\n/g, '\n')`) and this file's header comment.
    const escapeTextCell = (value) => String(value == null ? '' : value)
        .replace(/\\/g, '\\\\')
        .replace(/\|/g, '\\|')
        .replace(/\n/g, '\\n');

    // The Kind/Id/Text columns only exist to carry issue #1018's text
    // objects -- a plan with none still writes (and round-trips through)
    // the exact same seven-column post-it table it always has.
    const hasTextObjects = items.some(item => item && item.kind === 'text');
    const hasGroups = items.some(item => item && item.kind === 'group');
    if (hasTextObjects || hasGroups) headers.push('Kind', 'Id', 'Text');

    const rows = items.map(item => {
        const isText = !!(item && item.kind === 'text');
        const isGroup = !!(item && item.kind === 'group');
        const cells = [
            escapePipe(isText ? '' : (item.task || '')),
            escapePipe(String(item.x != null ? item.x : 0)),
            escapePipe(String(item.y != null ? item.y : 0)),
            escapePipe(isText ? '' : (item.colour || '')),
            escapePipe(isText ? '' : cellOrBlank(item.width)),
            escapePipe(isText ? '' : cellOrBlank(item.height)),
            // A boundary has no checklist to collapse, so it leaves the cell
            // blank rather than claiming a state it does not have.
            escapePipe((isText || isGroup) ? '' : (item.collapsed ? 'yes' : 'no')),
        ];
        if (hasTextObjects || hasGroups) {
            cells.push(
                escapePipe(isText ? 'text' : (isGroup ? 'group' : '')),
                escapePipe(isText ? (item.id || '') : ''),
                escapeTextCell(isText ? (item.text || '') : '')
            );
        }
        return cells;
    });

    const widths = headers.map(h => h.length);
    rows.forEach(row => row.forEach((cell, i) => { widths[i] = Math.max(widths[i], cell.length); }));

    const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));
    const formatRow = (cells) => '| ' + cells.map((c, i) => pad(c, widths[i])).join(' | ') + ' |';
    const separator = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';

    const lines = [formatRow(headers), separator];
    rows.forEach(row => lines.push(formatRow(row)));
    return lines.join('\n');
}

/**
 * Return warnings for orphan and duplicate whiteboard rows. Mirrors
 * Python's validate_whiteboard_rows(): neither rule removes anything
 * from `items`, this only reports (see docs/reference/plan-format.rst).
 *
 * @param {Array} items - parseWhiteboardMarkdown() output.
 * @param {Iterable} [summaryTaskNames] - valid summary task names to
 *   check rows against; orphan checking is skipped if omitted.
 */
function validateWhiteboardRows(items, summaryTaskNames) {
    // Task is matched case-insensitively, the same as dependency name
    // resolution (see "Resolution rules" in plan-format.rst).
    //
    // Issue #1018's text-object rows have no `.task` at all (they aren't
    // backed by a task -- see this file's "Whiteboard back matter" header
    // comment), so both rules below skip them entirely: "orphan"/
    // "duplicate" are concepts about a row's Task referencing (or
    // colliding with) a task name, which simply doesn't apply.
    const warnings = [];
    const nameCounts = {};
    items.forEach(item => {
        if (item && item.kind === 'text') return;
        const key = item.task.toLowerCase();
        nameCounts[key] = (nameCounts[key] || 0) + 1;
    });

    const seenDuplicates = new Set();
    items.forEach(item => {
        if (item && item.kind === 'text') return;
        const name = item.task;
        const key = name.toLowerCase();
        if (nameCounts[key] > 1 && !seenDuplicates.has(key)) {
            seenDuplicates.add(key);
            warnings.push({
                type: 'duplicate',
                task: name,
                message: `Multiple whiteboard rows reference task '${name}'; the later row wins.`,
            });
        }
    });

    if (summaryTaskNames) {
        const validNames = new Set(Array.from(summaryTaskNames, (n) => n.toLowerCase()));
        const seenOrphans = new Set();
        items.forEach(item => {
            if (item && item.kind === 'text') return;
            const name = item.task;
            const key = name.toLowerCase();
            if (name && !validNames.has(key) && !seenOrphans.has(key)) {
                seenOrphans.add(key);
                warnings.push({
                    type: 'orphan',
                    task: name,
                    message: `Whiteboard row references unknown task '${name}'; kept in the file but not rendered.`,
                });
            }
        });
    }

    return warnings;
}

/**
 * Update plan text with the given whiteboard items, rewriting only the
 * ---whiteboard--- section (canonical layout) and leaving every other
 * back-matter section, front matter, and the task outline untouched.
 * If `items` is empty, any existing whiteboard section is removed.
 *
 * Not wired to any per-keystroke/per-frame UI event in this issue (no
 * canvas yet -- #845/#846), so it is not wrapped in a DebounceTimer; a
 * future save-triggering caller should follow the DebounceTimer
 * convention used elsewhere in this file (e.g. resourceDebounceTimer).
 */
function updatePlanWhiteboardText(planText, items) {
    const startIdx = planText.indexOf(WHITEBOARD_START);
    let before = planText;
    let after = '';
    if (startIdx !== -1) {
        const afterStart = startIdx + WHITEBOARD_START.length;
        let endIdx = planText.length;
        for (const marker of [HIGHLIGHTS_START, HIGHLIGHTS_END, BUDGET_START, BENEFITS_START,
                              RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START,
                              PARKING_LOT_START]) {
            const mIdx = planText.indexOf(marker, afterStart);
            if (mIdx !== -1 && mIdx < endIdx) endIdx = mIdx;
        }
        before = planText.substring(0, startIdx);
        after = planText.substring(endIdx);
    }
    before = before.replace(/\n+$/, '');

    const table = generateWhiteboardText(items);
    let result = before;
    if (table) {
        result = result + '\n\n' + WHITEBOARD_START + '\n' + table;
    }
    if (after) {
        result = result.replace(/\n+$/, '') + '\n\n' + after.replace(/^\n+/, '');
    }
    return result;
}

/**
 * Rename rule: rename sync for whiteboard rows.
 *
 * Exact precedent: kanban.js's renamePhase() migrates the themeColours
 * key on phase rename (see the "Update theme colour key if phase had a
 * colour" block there). This is the equivalent migration for whiteboard
 * rows, which live in the plan body rather than front matter, so it
 * operates on the plan text directly. Every row whose Task matches
 * oldName is updated to newName; a no-op if there is no whiteboard
 * section or no matching row.
 */
function renamePlanWhiteboardTask(planText, oldName, newName) {
    if (!planText || !oldName || !newName || oldName === newName) return planText;
    const section = extractWhiteboardFromPlanText(planText);
    if (!section) return planText;

    const items = parseWhiteboardMarkdown(section);
    if (!items.length) return planText;

    let changed = false;
    items.forEach(item => {
        if (item.task === oldName) {
            item.task = newName;
            changed = true;
        }
    });
    if (!changed) return planText;

    return updatePlanWhiteboardText(planText, items);
}

// =====================================================================
// Parking lot (issue #1019, part of the #885 whiteboard epic)
//
// A "good idea, not now" holding pen: whiteboard.js's "Send to parking
// lot" note-menu action moves an item's text here instead of discarding
// it. Round-tripped using the marker ---parking lot---, canonically the
// section *after* ---whiteboard--- (see this file's own header comment
// above and format_converter.py's ALL_SECTION_MARKERS), followed by a
// table with columns:
//
//   ID | Text | Date Parked
//
// matched by name, not position, mirroring the whiteboard/RAID/comms
// table convention rather than highlights' heading-per-entry shape --
// a parked item is just one piece of free text, with nothing to group
// entries by the way highlights groups by date+author.
//
// Issue #1110 richer detail: an optional ``<!-- parking-lot-detail: ... -->``
// JSON comment can ride above the table, keyed by row id, carrying a
// snapshot too rich for the flat Text column -- a checklist note's
// individual child items, and the note's colour. Mirrors
// format_converter.py's generate_parking_lot_detail_comment()/
// extract_parking_lot_detail() exactly (see that file's own "Parking lot"
// header comment for the full schema and the baseline-history precedent
// it follows) -- keep the two in sync.
// =====================================================================

/**
 * Build the <!-- parking-lot-detail: ... --> comment line (issue #1110).
 * Mirrors format_converter.py's generate_parking_lot_detail_comment().
 */
function generateParkingLotDetailComment(detailMap) {
    if (!detailMap || Object.keys(detailMap).length === 0) return '';
    return '<!-- parking-lot-detail: ' + JSON.stringify(detailMap) + ' -->';
}

/**
 * Parse the parking-lot-detail comment out of a parking lot section's raw
 * text. Mirrors format_converter.py's extract_parking_lot_detail() --
 * defaults to {} for a plan with no comment (pre-#1110, or a hand-typed
 * section with just the table).
 */
function extractParkingLotDetailFromSectionText(sectionText) {
    if (!sectionText) return {};
    const m = sectionText.match(/<!--\s*parking-lot-detail:\s*(\{[\s\S]*?\})\s*-->/);
    if (!m) return {};
    try {
        const data = JSON.parse(m[1]);
        return (data && typeof data === 'object') ? data : {};
    } catch (e) {
        return {};
    }
}

/**
 * Extract the raw ---parking lot--- section text from plan text, or ''
 * if there isn't one.
 */
function extractParkingLotFromPlanText(planText) {
    if (!planText) return '';
    const startIdx = planText.indexOf(PARKING_LOT_START);
    if (startIdx === -1) return '';
    const afterStart = startIdx + PARKING_LOT_START.length;

    // Parking lot is canonically the last back-matter section, but stay
    // defensive in case some other marker follows it in hand-edited text.
    let endIdx = planText.length;
    for (const marker of [HIGHLIGHTS_START, HIGHLIGHTS_END, BUDGET_START, BENEFITS_START,
                          RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START,
                          WHITEBOARD_START]) {
        const mIdx = planText.indexOf(marker, afterStart);
        if (mIdx !== -1 && mIdx < endIdx) endIdx = mIdx;
    }

    return planText.substring(afterStart, endIdx).trim();
}

/**
 * Parse a parking lot markdown table into an array of item objects.
 * Columns are matched by name, not position: ID | Text | Date Parked in
 * any order, extra columns tolerated and ignored. Mirrors
 * format_converter.py's parse_parking_lot_markdown.
 */
function parseParkingLotMarkdown(text) {
    if (!text) return [];
    const detailMap = extractParkingLotDetailFromSectionText(text);
    const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('<!--'));

    function parseRow(line) {
        let parts = line.split(/(?<!\\)\|/);
        if (parts.length && !parts[0].trim()) parts = parts.slice(1);
        if (parts.length && !parts[parts.length - 1].trim()) parts = parts.slice(0, -1);
        return parts.map(c => c.trim());
    }

    let headerIndex = -1;
    let headers = [];
    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes('|')) continue;
        const cells = parseRow(lines[i]).map(c => c.toLowerCase());
        if (cells.includes('text')) {
            headerIndex = i;
            headers = cells;
            break;
        }
    }
    if (headerIndex === -1) return [];

    const aliases = { id: 'id', text: 'text', 'date parked': 'date_parked' };
    const colMap = {};
    headers.forEach((h, idx) => {
        if (aliases[h] && !(aliases[h] in colMap)) colMap[aliases[h]] = idx;
    });

    const items = [];
    let maxId = 0;
    for (let i = headerIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes('|')) continue;
        if (line.replace(/[|\- ]/g, '') === '') continue; // separator row
        if (line.startsWith('//')) continue;

        const cells = parseRow(line);
        if (!cells.length) continue;

        function getCell(field, fallback) {
            const idx = colMap[field];
            if (idx !== undefined && idx < cells.length) return cells[idx].replace(/\\\|/g, '|');
            return fallback !== undefined ? fallback : '';
        }

        const text = getCell('text', '');
        if (!text) continue;

        const idStr = getCell('id', '');
        const parsedId = parseInt(idStr, 10);
        const itemId = idStr && !Number.isNaN(parsedId) ? parsedId : maxId + 1;
        maxId = Math.max(maxId, itemId);

        const item = {
            id: itemId,
            text,
            date_parked: getCell('date_parked', ''),
        };
        const detail = detailMap[String(itemId)];
        if (detail && typeof detail === 'object') item.detail = detail;
        items.push(item);
    }
    return items;
}

/**
 * Generate a formatted markdown table from parking lot items, columns
 * padded to their widest entry (matching the other back-matter
 * generators). Any item carrying a `detail` key (issue #1110) has that
 * detail folded into a single parking-lot-detail comment line above the
 * table -- see generateParkingLotDetailComment(). Returns '' if there
 * are no items.
 */
function generateParkingLotText(items) {
    if (!items || items.length === 0) return '';
    const headers = ['ID', 'Text', 'Date Parked'];

    const escapePipe = (value) => String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\n/g, ' ');

    const detailMap = {};
    const rows = items.map(item => {
        if (item.detail) detailMap[String(item.id)] = item.detail;
        return [
            escapePipe(item.id),
            escapePipe(item.text || ''),
            escapePipe(item.date_parked || ''),
        ];
    });

    const widths = headers.map(h => h.length);
    rows.forEach(row => row.forEach((cell, i) => { widths[i] = Math.max(widths[i], cell.length); }));

    const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));
    const formatRow = (cells) => '| ' + cells.map((c, i) => pad(c, widths[i])).join(' | ') + ' |';
    const separator = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';

    const lines = [formatRow(headers), separator];
    rows.forEach(row => lines.push(formatRow(row)));
    const table = lines.join('\n');

    const detailComment = generateParkingLotDetailComment(detailMap);
    return detailComment ? detailComment + '\n\n' + table : table;
}

/**
 * Update plan text with the given parking lot items, rewriting only the
 * ---parking lot--- section and leaving every other back-matter section,
 * front matter, and the task outline untouched. If `items` is empty, any
 * existing parking lot section is removed. Parking lot is canonically the
 * last back-matter section, so nothing needs to be preserved and
 * re-appended after it -- mirrors updatePlanWhiteboardText().
 */
function updatePlanParkingLotText(planText, items) {
    const startIdx = planText.indexOf(PARKING_LOT_START);
    let before = planText;
    let after = '';
    if (startIdx !== -1) {
        const afterStart = startIdx + PARKING_LOT_START.length;
        let endIdx = planText.length;
        for (const marker of [HIGHLIGHTS_START, HIGHLIGHTS_END, BUDGET_START, BENEFITS_START,
                              RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START,
                              WHITEBOARD_START]) {
            const mIdx = planText.indexOf(marker, afterStart);
            if (mIdx !== -1 && mIdx < endIdx) endIdx = mIdx;
        }
        before = planText.substring(0, startIdx);
        after = planText.substring(endIdx);
    }
    before = before.replace(/\n+$/, '');

    const table = generateParkingLotText(items);
    let result = before;
    if (table) {
        result = result + '\n\n' + PARKING_LOT_START + '\n' + table;
    }
    if (after) {
        result = result.replace(/\n+$/, '') + '\n\n' + after.replace(/^\n+/, '');
    }
    return result;
}

/**
 * Build a lookup map from baseline items for quick name-based access.
 */
function getBaselineLookup() {
    const lookup = {};
    baselineItems.forEach(item => {
        lookup[item.name] = item;
    });
    return lookup;
}


/**
 * Stakeholder Interest/Influence Grid System
 * Stakeholders stored in front matter YAML Key Stakeholders section.
 * Format: - @Name: Role, interest:high, influence:low
 */

// Stakeholder state is now in state.js

/**
 * Clear stakeholder entries from the UI and global state.
 */
function clearStakeholders() {
    stakeholderItems = [];
    stakeholderNextId = 1;
    renderStakeholderTable();
    renderStakeholderGrid();
}

/**
 * Add a new stakeholder (opens the form).
 */
function addStakeholder() {
    openStakeholderForm(null);
}

/**
 * Open the stakeholder form for editing or creating.
 */
function openStakeholderForm(itemId) {
    const title = document.getElementById('stakeholderFormTitle');
    const idField = document.getElementById('stakeholderItemId');

    if (itemId != null) {
        const item = stakeholderItems.find(i => i.id === itemId);
        if (!item) return;

        title.textContent = 'Edit Stakeholder';
        idField.value = item.id;
        document.getElementById('stakeholderItemShortname').value = item.shortname || '';
        document.getElementById('stakeholderItemName').value = item.name;
        document.getElementById('stakeholderItemRole').value = item.role;
        document.getElementById('stakeholderItemInterest').value = item.interest;
        document.getElementById('stakeholderItemInfluence').value = item.influence;
    } else {
        title.textContent = 'New Stakeholder';
        idField.value = '';
        document.getElementById('stakeholderItemShortname').value = '';
        document.getElementById('stakeholderItemName').value = '';
        document.getElementById('stakeholderItemRole').value = '';
        document.getElementById('stakeholderItemInterest').value = 'high';
        document.getElementById('stakeholderItemInfluence').value = 'high';
    }

    openDetailPane('stakeholderFormSection');
}

/**
 * Close the stakeholder form.
 */
function closeStakeholderForm() {
    closeDetailPane();
}

/**
 * Save stakeholder from the form.
 */
function saveStakeholderFromForm() {
    const idField = document.getElementById('stakeholderItemId').value;
    const shortname = document.getElementById('stakeholderItemShortname').value.trim();
    const name = document.getElementById('stakeholderItemName').value.trim();

    if (!name) {
        alert('Please enter a name for the stakeholder.');
        return;
    }

    const itemData = {
        shortname: shortname || name.split(' ')[0].toLowerCase(),
        name: name,
        role: document.getElementById('stakeholderItemRole').value.trim(),
        interest: document.getElementById('stakeholderItemInterest').value,
        influence: document.getElementById('stakeholderItemInfluence').value
    };

    if (idField) {
        const existingId = parseInt(idField);
        const index = stakeholderItems.findIndex(i => i.id === existingId);
        if (index >= 0) {
            stakeholderItems[index] = { ...stakeholderItems[index], ...itemData };
        }
    } else {
        itemData.id = stakeholderNextId++;
        stakeholderItems.push(itemData);
    }

    closeStakeholderForm();
    renderStakeholderTable();
    renderStakeholderGrid();
    syncStakeholdersToFrontMatter();
}

/**
 * Delete a stakeholder by id.
 */
function deleteStakeholder(id) {
    if (!confirm('Are you sure you want to delete this stakeholder?')) return;
    stakeholderItems = stakeholderItems.filter(i => i.id !== id);
    renderStakeholderTable();
    renderStakeholderGrid();
    syncStakeholdersToFrontMatter();
}

/**
 * Render the stakeholders table from the stakeholderItems array.
 */
function renderStakeholderTable() {
    const tbody = document.getElementById('stakeholdersTableBody');
    const emptyState = document.getElementById('stakeholdersEmptyState');
    const table = document.getElementById('stakeholdersTable');
    if (!tbody || !emptyState || !table) return;

    tbody.innerHTML = '';

    if (stakeholderItems.length === 0) {
        emptyState.hidden = false;
        table.style.display = 'none';
        return;
    }

    emptyState.hidden = true;
    table.style.display = 'table';

    stakeholderItems.forEach(item => {
        const row = document.createElement('tr');
        const interestLabel = item.interest === 'high' ? 'High' : 'Low';
        const influenceLabel = item.influence === 'high' ? 'High' : 'Low';
        const interestClass = item.interest === 'high' ? 'stakeholder-level-high' : 'stakeholder-level-low';
        const influenceClass = item.influence === 'high' ? 'stakeholder-level-high' : 'stakeholder-level-low';

        row.innerHTML = `
            <td><code>@${escapeHtml(item.shortname || '')}</code></td>
            <td>${escapeHtml(item.name)}</td>
            <td>${escapeHtml(item.role)}</td>
            <td><span class="stakeholder-level-badge ${interestClass}">${interestLabel}</span></td>
            <td><span class="stakeholder-level-badge ${influenceClass}">${influenceLabel}</span></td>
            <td>
                <np-button icon-only variant="neutral" size="small" title="Edit" label="Edit" onclick="openStakeholderForm(${item.id})"><span slot="icon">&#9998;&#65039;</span></np-button>
                <np-button icon-only variant="danger" size="small" title="Delete" label="Delete" onclick="deleteStakeholder(${item.id})"><span slot="icon">&#128465;&#65039;</span></np-button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

/**
 * Choose the shortest unique display name for stakeholders in a quadrant.
 * Returns full name if few items, first name if unique, or initials if needed.
 */
function getQuadrantDisplayNames(items) {
    if (items.length <= 3) {
        return items.map(item => item.name.replace(/^@/, ''));
    }

    const fullNames = items.map(item => item.name.replace(/^@/, ''));
    const firstNames = fullNames.map(n => n.split(/[\s.]+/)[0]);

    const firstNameCounts = {};
    firstNames.forEach(fn => { firstNameCounts[fn] = (firstNameCounts[fn] || 0) + 1; });

    const allFirstNamesUnique = Object.values(firstNameCounts).every(c => c === 1);

    if (items.length <= 6 && allFirstNamesUnique) {
        return firstNames;
    }

    // Use initials, falling back to first name if initials collide
    const initialsMap = {};
    const displayNames = fullNames.map((name, i) => {
        const initials = name.split(/[\s.]+/).map(w => w[0]).join('').toUpperCase();
        if (!initialsMap[initials]) {
            initialsMap[initials] = true;
            return initials;
        }
        return firstNames[i];
    });
    return displayNames;
}

/**
 * Render the stakeholder interest/influence grid as SVG.
 */
function renderStakeholderGrid() {
    const svg = document.getElementById('stakeholderGrid');
    if (!svg) return;

    svg.innerHTML = '';

    const size = 400;
    const padding = 50;
    const gridSize = size - 2 * padding;
    const half = gridSize / 2;
    const cx = padding;
    const cy = padding;

    // Background quadrants with titles at bottom-middle of each quadrant
    const quadrants = [
        { x: cx, y: cy, fill: '#f0f4ff', label: 'Keep Informed', labelX: cx + half / 2, labelY: cy + half - 10 },
        { x: cx + half, y: cy, fill: '#e8f5e9', label: 'Manage', labelX: cx + half + half / 2, labelY: cy + half - 10 },
        { x: cx, y: cy + half, fill: '#fff8e1', label: 'Monitor', labelX: cx + half / 2, labelY: cy + half + half - 10 },
        { x: cx + half, y: cy + half, fill: '#fce4ec', label: 'Watch', labelX: cx + half + half / 2, labelY: cy + half + half - 10 }
    ];

    quadrants.forEach(q => {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', q.x);
        rect.setAttribute('y', q.y);
        rect.setAttribute('width', half);
        rect.setAttribute('height', half);
        rect.setAttribute('fill', q.fill);
        rect.setAttribute('stroke', '#ddd');
        rect.setAttribute('stroke-width', '1');
        svg.appendChild(rect);

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', q.labelX);
        text.setAttribute('y', q.labelY);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'auto');
        text.setAttribute('fill', '#bbb');
        text.setAttribute('font-size', '14');
        text.setAttribute('font-weight', '500');
        text.textContent = q.label;
        svg.appendChild(text);
    });

    // Grid border
    const border = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    border.setAttribute('x', cx);
    border.setAttribute('y', cy);
    border.setAttribute('width', gridSize);
    border.setAttribute('height', gridSize);
    border.setAttribute('fill', 'none');
    border.setAttribute('stroke', '#999');
    border.setAttribute('stroke-width', '2');
    svg.appendChild(border);

    // Axis labels
    const axisLabels = [
        { text: 'Low Interest', x: cx + half / 2, y: size - 10, anchor: 'middle' },
        { text: 'High Interest', x: cx + half + half / 2, y: size - 10, anchor: 'middle' },
        { text: 'INTEREST \u2192', x: cx + half, y: size - 25, anchor: 'middle' }
    ];

    axisLabels.forEach(lbl => {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', lbl.x);
        text.setAttribute('y', lbl.y);
        text.setAttribute('text-anchor', lbl.anchor);
        text.setAttribute('fill', '#666');
        text.setAttribute('font-size', '11');
        text.textContent = lbl.text;
        svg.appendChild(text);
    });

    // Vertical axis labels (rotated)
    const influenceLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    influenceLabel.setAttribute('x', 12);
    influenceLabel.setAttribute('y', cx + half);
    influenceLabel.setAttribute('text-anchor', 'middle');
    influenceLabel.setAttribute('fill', '#666');
    influenceLabel.setAttribute('font-size', '11');
    influenceLabel.setAttribute('transform', `rotate(-90, 12, ${cx + half})`);
    influenceLabel.textContent = '\u2190 INFLUENCE \u2192';
    svg.appendChild(influenceLabel);

    const highInfluenceLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    highInfluenceLabel.setAttribute('x', 28);
    highInfluenceLabel.setAttribute('y', cy + half / 2);
    highInfluenceLabel.setAttribute('text-anchor', 'middle');
    highInfluenceLabel.setAttribute('fill', '#666');
    highInfluenceLabel.setAttribute('font-size', '11');
    highInfluenceLabel.setAttribute('transform', `rotate(-90, 28, ${cy + half / 2})`);
    highInfluenceLabel.textContent = 'High Influence';
    svg.appendChild(highInfluenceLabel);

    const lowInfluenceLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    lowInfluenceLabel.setAttribute('x', 28);
    lowInfluenceLabel.setAttribute('y', cy + half + half / 2);
    lowInfluenceLabel.setAttribute('text-anchor', 'middle');
    lowInfluenceLabel.setAttribute('fill', '#666');
    lowInfluenceLabel.setAttribute('font-size', '11');
    lowInfluenceLabel.setAttribute('transform', `rotate(-90, 28, ${cy + half + half / 2})`);
    lowInfluenceLabel.textContent = 'Low Influence';
    svg.appendChild(lowInfluenceLabel);

    // Group stakeholders by quadrant for display name shortening
    const quadrantGroups = {};
    stakeholderItems.forEach(item => {
        const key = `${item.interest}-${item.influence}`;
        if (!quadrantGroups[key]) quadrantGroups[key] = [];
        quadrantGroups[key].push(item);
    });

    // Compute display names per quadrant
    const displayNameMap = {};
    Object.keys(quadrantGroups).forEach(key => {
        const group = quadrantGroups[key];
        const names = getQuadrantDisplayNames(group);
        group.forEach((item, i) => { displayNameMap[item.id] = names[i]; });
    });

    // Plot stakeholders with grid layout to prevent overlap
    const colors = ['#667eea', '#764ba2', '#f97316', '#10b981', '#ef4444', '#06b6d4', '#8b5cf6', '#ec4899'];
    const positions = {};

    stakeholderItems.forEach((item, index) => {
        const isHighInterest = item.interest === 'high';
        const isHighInfluence = item.influence === 'high';

        const quadrantX = isHighInterest ? cx + half : cx;
        const quadrantY = isHighInfluence ? cy : cy + half;

        const key = `${item.interest}-${item.influence}`;
        if (!positions[key]) positions[key] = 0;
        const posIndex = positions[key];
        positions[key]++;

        const count = quadrantGroups[key].length;
        // Arrange items in columns of up to 3 rows, centered in the quadrant
        const cols = Math.ceil(count / 3);
        const col = Math.floor(posIndex / 3);
        const row = posIndex % 3;
        const colSpacing = Math.min(50, (half - 20) / Math.max(cols, 1));
        const rowSpacing = Math.min(30, (half - 40) / 3);

        const startX = quadrantX + half / 2 - ((cols - 1) * colSpacing) / 2;
        const startY = quadrantY + 20 + row * rowSpacing;

        const dotX = startX + col * colSpacing;
        const dotY = startY;

        const color = colors[index % colors.length];

        // Dot
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', dotX);
        circle.setAttribute('cy', dotY);
        circle.setAttribute('r', '8');
        circle.setAttribute('fill', color);
        circle.setAttribute('stroke', '#fff');
        circle.setAttribute('stroke-width', '2');
        svg.appendChild(circle);

        // Label using potentially shortened display name
        const displayName = displayNameMap[item.id] || item.name.replace(/^@/, '');
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', dotX);
        label.setAttribute('y', dotY + 18);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('fill', '#333');
        label.setAttribute('font-size', count > 6 ? '9' : '11');
        label.setAttribute('font-weight', '500');
        label.textContent = displayName;
        svg.appendChild(label);
    });
}

/**
 * Parse stakeholders from front matter YAML.
 * Expected format: - @Name: Role, interest:high, influence:low
 */
function parseStakeholdersFromFrontMatter(frontMatterStr) {
    const items = [];
    if (!frontMatterStr) return items;

    const lines = frontMatterStr.split('\n');
    let inStakeholders = false;

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.toLowerCase() === 'key stakeholders:' || trimmed.toLowerCase() === 'stakeholders:') {
            inStakeholders = true;
            continue;
        }

        if (inStakeholders && trimmed.match(/^[a-z\s]+:/i) && !trimmed.startsWith('-')) {
            break;
        }

        if (inStakeholders && trimmed.startsWith('-')) {
            const entry = trimmed.substring(1).trim(); // Remove "- "
            // Accept with or without @ prefix
            const item = parseStakeholderEntry(entry.startsWith('@') ? entry : '@' + entry);
            if (item) {
                item.id = stakeholderNextId++;
                items.push(item);
            }
        }
    }

    return items;
}

/**
 * Parse a single stakeholder entry string.
 * Format: @Name: Role, interest:high, influence:low
 */
function parseStakeholderEntry(entry) {
    if (!entry || !entry.startsWith('@')) return null;

    // Format: @shortname: Full Name, Role, interest:high, influence:low
    const colonIndex = entry.indexOf(':');
    if (colonIndex === -1) {
        const fullName = entry.replace(/^@/, '').trim();
        return { shortname: fullName.split(' ')[0].toLowerCase(), name: fullName, role: '', interest: 'low', influence: 'low' };
    }

    const shortname = entry.substring(1, colonIndex).trim().toLowerCase(); // after @ before :
    const rest = entry.substring(colonIndex + 1).trim();

    // Parse comma-separated values
    // Format: Full Name, Role, interest:high, influence:low
    const parts = rest.split(',').map(p => p.trim());

    let name = '';
    let role = '';
    let interest = 'low';
    let influence = 'low';

    const textParts = [];

    for (const part of parts) {
        const kvMatch = part.match(/^(interest|influence):\s*(high|low)$/i);
        if (kvMatch) {
            if (kvMatch[1].toLowerCase() === 'interest') {
                interest = kvMatch[2].toLowerCase();
            } else if (kvMatch[1].toLowerCase() === 'influence') {
                influence = kvMatch[2].toLowerCase();
            }
        } else {
            textParts.push(part);
        }
    }

    // First text part is the name, rest is the role
    if (textParts.length > 0) name = textParts[0];
    if (textParts.length > 1) role = textParts.slice(1).join(', ');

    // Fallback: if no name parsed, use shortname
    if (!name) name = shortname;

    return { shortname, name, role, interest, influence };
}

/**
 * Sync stakeholders back to the front matter YAML in the plan editor.
 */
function syncStakeholdersToFrontMatter() {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const content = editor.value;
    const updatedContent = updateFrontMatterStakeholders(content, stakeholderItems);

    if (updatedContent !== content) {
        setEditorValuePreservingCursor(editor, updatedContent);
        const kanbanEditor = document.getElementById('kanbanPlanEditor');
        if (kanbanEditor) {
            kanbanEditor.value = updatedContent;
        }
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

/**
 * Update the front matter in plan text with the current stakeholder items.
 */
function updateFrontMatterStakeholders(planText, items) {
    const frontMatterMatch = planText.match(/^(---\s*\n)([\s\S]*?)(\n---)/);
    if (!frontMatterMatch) {
        // No front matter exists -- create one with stakeholders
        if (items.length === 0) return planText;
        let fm = '---\n';
        fm += generateStakeholdersFrontMatterSection(items);
        fm += '---\n';
        return fm + planText;
    }

    const prefix = frontMatterMatch[1];
    const fmContent = frontMatterMatch[2];
    const suffix = frontMatterMatch[3];

    // Remove existing Key Stakeholders section
    const lines = fmContent.split('\n');
    const newLines = [];
    let inStakeholders = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.toLowerCase() === 'key stakeholders:' || trimmed.toLowerCase() === 'stakeholders:') {
            inStakeholders = true;
            continue;
        }
        if (inStakeholders) {
            if (trimmed.startsWith('- @') || trimmed === '') {
                continue;
            }
            inStakeholders = false;
        }
        newLines.push(line);
    }

    // Add updated stakeholders section
    let newFmContent = newLines.join('\n');
    if (items.length > 0) {
        if (!newFmContent.endsWith('\n')) newFmContent += '\n';
        newFmContent += generateStakeholdersFrontMatterSection(items);
    }

    return prefix + newFmContent + suffix + planText.substring(frontMatterMatch[0].length);
}

/**
 * Generate the Key Stakeholders front matter section string.
 */
function generateStakeholdersFrontMatterSection(items) {
    if (items.length === 0) return '';

    let section = 'Key Stakeholders:\n';
    items.forEach(item => {
        const sn = item.shortname || item.name.split(' ')[0].toLowerCase();
        let line = `- @${sn}: ${item.name}, ${item.role}`;
        line += `, interest:${item.interest}`;
        line += `, influence:${item.influence}`;
        section += line + '\n';
    });
    return section;
}

/**
 * Load stakeholders from the plan text front matter.
 */
function loadStakeholdersFromPlanText() {
    const editor = document.getElementById('planEditor');
    if (!editor || !editor.value) return;

    const frontMatterMatch = editor.value.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!frontMatterMatch) return;

    const parsed = parseStakeholdersFromFrontMatter(frontMatterMatch[1]);
    if (parsed.length > 0) {
        stakeholderItems = parsed;
        renderStakeholderTable();
        renderStakeholderGrid();
    }
}


/**
 * Highlights System
 * Project highlights / reporting entries stored in the plan text.
 */

// highlightsData is now in state.js

/**
 * Clear highlights from the UI and global state.
 * This should be called before loading a new plan to ensure
 * old highlights don't persist.
 */
function clearHighlights() {
    highlightsData = [];

    // Re-render the highlights list to show empty state
    renderHighlightsList();

    console.log('Cleared highlights');
}

/**
 * Clear both RAID log entries and highlights before loading a new plan.
 * This ensures that old data doesn't persist when switching between plans.
 */
function clearPlanTrackingData() {
    clearRaidLogEntries();
    clearBudgetEntries();
    clearCommsEntries();
    if (typeof clearLessonsEntries === 'function') clearLessonsEntries();
    clearHighlights();
    clearStakeholders();
    baselineItems = [];
    showBaselineToggle(false);
}

/**
 * Extract highlights from plan text on the client side.
 *
 * This is the JavaScript equivalent of the Python extract_highlights()
 * function in format_converter.py.  It provides a fallback when the
 * backend /api/parse endpoint fails or does not return highlights.
 *
 * Parses the ---highlights--- section and returns an array of
 * {date, author, content} objects.
 */
function extractHighlightsFromText(text) {
    if (!text) return [];

    const HIGHLIGHTS_START = '---highlights---';
    const HIGHLIGHTS_END = '---end-highlights---';
    const RAID_LOG_START_MARKER = '---raid log---';
    const BUDGET_START_MARKER = '---budget---';

    const startIdx = text.indexOf(HIGHLIGHTS_START);
    if (startIdx === -1) return [];

    const afterStart = startIdx + HIGHLIGHTS_START.length;

    // Find the end: explicit end marker, budget section, raid log section,
    // whiteboard section, or EOF
    let endIdx = text.length;
    for (const marker of [HIGHLIGHTS_END, BUDGET_START_MARKER, RAID_LOG_START_MARKER, WHITEBOARD_START]) {
        const idx = text.indexOf(marker, afterStart);
        if (idx !== -1 && idx < endIdx) {
            endIdx = idx;
        }
    }

    const section = text.substring(afterStart, endIdx);
    const highlights = [];
    let current = null;
    const headingRe = /^##\s+(\d{4}-\d{2}-\d{2})\s+@(\S+)\s*$/;

    for (const line of section.split('\n')) {
        const stripped = line.trim();

        // Skip blank lines before the first heading
        if (!stripped && current === null) continue;

        const match = stripped.match(headingRe);
        if (match) {
            if (current !== null) {
                current.content = current.content.trimEnd();
                highlights.push(current);
            }
            current = { date: match[1], author: match[2], content: '' };
            continue;
        }

        // Content line (belongs to current highlight), including blank lines
        if (current !== null) {
            current.content += line.trimEnd() + '\n';
        }
    }

    // Don't forget the last highlight
    if (current !== null) {
        current.content = current.content.trimEnd();
        highlights.push(current);
    }

    return highlights;
}

/**
 * Update the highlights view with data from the backend parse response.
 */
function updateHighlightsView(highlights) {
    highlightsData = highlights || [];

    // Show content, hide placeholder
    const placeholder = document.querySelector('#highlights-view .highlights-placeholder');
    const content = document.querySelector('#highlights-view .highlights-content');
    if (placeholder && content) {
        placeholder.style.display = 'none';
        content.style.display = 'block';
    }

    renderHighlightsList();
}

/**
 * Render the list of highlights (newest first).
 */
function renderHighlightsList() {
    const list = document.getElementById('highlightsList');
    const emptyState = document.getElementById('highlightsEmptyState');
    if (!list) return;

    list.innerHTML = '';

    if (highlightsData.length === 0) {
        if (emptyState) emptyState.hidden = false;
        return;
    }
    if (emptyState) emptyState.hidden = true;

    // Show newest first
    const sorted = [...highlightsData].reverse();
    sorted.forEach((h, reverseIdx) => {
        const originalIdx = highlightsData.length - 1 - reverseIdx;
        const card = document.createElement('div');
        card.className = 'highlight-card';
        card.innerHTML = `
            <div class="highlight-card-header">
                <div class="highlight-meta">
                    <span class="highlight-date">${escapeHtml(h.date)}</span>
                    <span class="highlight-author">@${escapeHtml(h.author)}</span>
                </div>
                <div class="highlight-actions">
                    <np-button icon-only variant="neutral" size="small" title="Edit" label="Edit" onclick="editHighlight(${originalIdx})"><span slot="icon">&#9998;</span></np-button>
                    <np-button icon-only variant="danger" size="small" title="Delete" label="Delete" onclick="deleteHighlight(${originalIdx})"><span slot="icon">&#128465;</span></np-button>
                </div>
            </div>
            <div class="highlight-body">${renderSimpleMarkdown(h.content)}</div>
        `;
        list.appendChild(card);
    });
}

/**
 * Simple markdown-to-HTML converter for highlight content.
 * Supports: bold, italic, strikethrough, bullet lists, numbered lists,
 * h1-h3 headings, and horizontal rules.
 */
function renderSimpleMarkdown(text) {
    if (!text) return '';

    const lines = text.split('\n');
    let html = '';
    let inUl = false;
    let inOl = false;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const trimmed = line.trim();

        // Horizontal rule
        if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
            if (inUl) { html += '</ul>'; inUl = false; }
            if (inOl) { html += '</ol>'; inOl = false; }
            html += '<hr>';
            continue;
        }

        // Headings
        const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
        if (headingMatch) {
            if (inUl) { html += '</ul>'; inUl = false; }
            if (inOl) { html += '</ol>'; inOl = false; }
            const level = headingMatch[1].length;
            html += `<h${level}>${inlineMarkdown(escapeHtml(headingMatch[2]))}</h${level}>`;
            continue;
        }

        // Unordered list item
        const ulMatch = trimmed.match(/^[-*+]\s+(.+)$/);
        if (ulMatch) {
            if (inOl) { html += '</ol>'; inOl = false; }
            if (!inUl) { html += '<ul>'; inUl = true; }
            html += `<li>${inlineMarkdown(escapeHtml(ulMatch[1]))}</li>`;
            continue;
        }

        // Ordered list item
        const olMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
        if (olMatch) {
            if (inUl) { html += '</ul>'; inUl = false; }
            if (!inOl) { html += '<ol>'; inOl = true; }
            html += `<li>${inlineMarkdown(escapeHtml(olMatch[1]))}</li>`;
            continue;
        }

        // Close open lists
        if (inUl) { html += '</ul>'; inUl = false; }
        if (inOl) { html += '</ol>'; inOl = false; }

        // Blank line
        if (!trimmed) {
            continue;
        }

        // Paragraph
        html += `<p>${inlineMarkdown(escapeHtml(trimmed))}</p>`;
    }

    if (inUl) html += '</ul>';
    if (inOl) html += '</ol>';

    return html;
}

/**
 * Apply inline markdown formatting: bold, italic, strikethrough.
 */
function inlineMarkdown(text) {
    // Bold: **text** or __text__
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
    // Italic: *text* or _text_
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    text = text.replace(/_(.+?)_/g, '<em>$1</em>');
    // Strikethrough: ~~text~~
    text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');
    return text;
}

/**
 * Open the highlight form for a new entry.
 */
function addHighlight() {
    openHighlightForm(null);
}

/**
 * Open the highlight form for editing an existing entry.
 */
function editHighlight(index) {
    openHighlightForm(index);
}

/**
 * Delete a highlight by index.
 */
function deleteHighlight(index) {
    if (!confirm('Are you sure you want to delete this highlight?')) return;
    highlightsData.splice(index, 1);
    renderHighlightsList();
    syncHighlightsToPlanText();
    updateReportHighlight();
}

/**
 * Open the highlight form in the detail pane.
 */
function openHighlightForm(index) {
    const title = document.getElementById('highlightFormTitle');
    const indexField = document.getElementById('highlightItemIndex');
    const dateField = document.getElementById('highlightDate');
    const authorField = document.getElementById('highlightAuthor');
    const contentField = document.getElementById('highlightContent');

    // Populate author dropdown from plan resources
    populateHighlightAuthorDropdown();

    if (index !== null && index >= 0 && index < highlightsData.length) {
        const item = highlightsData[index];
        title.textContent = 'Edit Highlight';
        indexField.value = String(index);
        dateField.value = item.date;
        contentField.value = item.content;
        // Set author after populating dropdown
        setTimeout(() => { authorField.value = item.author; }, 0);
    } else {
        title.textContent = 'New Highlight';
        indexField.value = '';
        dateField.value = new Date().toISOString().slice(0, 10);
        contentField.value = '';
        // Default to first resource if available
        setTimeout(() => {
            if (authorField.options.length > 1) {
                authorField.selectedIndex = 1;
            }
        }, 0);
    }

    openDetailPane('highlightFormSection');
}

/**
 * Close the highlight form.
 */
function closeHighlightForm() {
    closeDetailPane();
}

/**
 * Populate the author dropdown in the highlight form from plan resources.
 */
function populateHighlightAuthorDropdown() {
    const authorField = document.getElementById('highlightAuthor');
    if (!authorField) return;

    const resources = getAllResourceNames();
    authorField.innerHTML = '<option value="">-- Select --</option>';
    resources.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        authorField.appendChild(option);
    });
}

/**
 * Save highlight from the form.
 */
function saveHighlightFromForm() {
    const indexField = document.getElementById('highlightItemIndex').value;
    const date = document.getElementById('highlightDate').value;
    const author = document.getElementById('highlightAuthor').value;
    const content = document.getElementById('highlightContent').value.trim();

    if (!date) {
        alert('Please select a date.');
        return;
    }
    if (!author) {
        alert('Please select an author.');
        return;
    }
    if (!content) {
        alert('Please enter highlight content.');
        return;
    }

    const item = { date: date, author: author, content: content };

    if (indexField !== '') {
        const idx = parseInt(indexField);
        if (idx >= 0 && idx < highlightsData.length) {
            highlightsData[idx] = item;
        }
    } else {
        highlightsData.push(item);
    }

    closeHighlightForm();
    renderHighlightsList();
    syncHighlightsToPlanText();
    updateReportHighlight();
}

/**
 * Sync highlights data back into the plan editor text.
 *
 * Generates the highlights section and updates the plan text
 * in the editor, preserving existing content.
 */
async function syncHighlightsToPlanText() {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const planText = editor.value;
    const updatedText = updatePlanHighlightsText(planText, highlightsData);

    if (updatedText !== planText) {
        setEditorValuePreservingCursor(editor, updatedText);
        // Sync to kanban editor if it exists
        const kanbanEditor = document.getElementById('kanbanPlanEditor');
        if (kanbanEditor) {
            kanbanEditor.value = updatedText;
        }
        // Fire input event so all views (including debounced auto-render) stay in sync
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

/**
 * Update plan text with highlights section.
 * JavaScript equivalent of the Python update_plan_highlights function.
 */
function updatePlanHighlightsText(planText, highlights) {
    const HIGHLIGHTS_START = '---highlights---';
    const HIGHLIGHTS_END = '---end-highlights---';
    const BASELINE_START = '---baseline---';
    // All section markers that can terminate highlights
    const END_MARKERS = [HIGHLIGHTS_END, BUDGET_START, '---benefits---', RAID_LOG_START, COMMS_START, BASELINE_START, WHITEBOARD_START];

    // Extract each trailing section so we can re-append them in canonical order
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

    const budgetText = extractSection(planText, BUDGET_START, ['---benefits---', RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START]);
    const benefitsText = extractSection(planText, '---benefits---', [RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START]);
    const raidText = extractSection(planText, RAID_LOG_START, [COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START]);
    const commsText = extractSection(planText, COMMS_START, [LESSONS_START, BASELINE_START, WHITEBOARD_START]);
    const lessonsText = extractSection(planText, LESSONS_START, [BASELINE_START, WHITEBOARD_START]);
    const baselineText = extractSection(planText, BASELINE_START, [WHITEBOARD_START]);
    const whiteboardText = extractSection(planText, WHITEBOARD_START, []);

    // Strip all special sections from base to get just tasks + front matter
    let base = planText;
    // Strip from earliest section marker onwards
    const sectionMarkers = [HIGHLIGHTS_START, BUDGET_START, '---benefits---', RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START];
    let earliestIdx = base.length;
    for (const marker of sectionMarkers) {
        const idx = base.indexOf(marker);
        if (idx !== -1 && idx < earliestIdx) earliestIdx = idx;
    }
    if (earliestIdx < base.length) {
        base = base.substring(0, earliestIdx);
    }
    base = base.replace(/\n+$/, '');

    // Remove trailing --- separator that preceded the highlights section
    let lines = base.split('\n');
    while (lines.length > 0 && lines[lines.length - 1].trim() === '---') {
        lines.pop();
    }
    base = lines.join('\n').replace(/\n+$/, '');

    // Generate new highlights section
    let result;
    if (!highlights || highlights.length === 0) {
        result = base;
    } else {
        let section = HIGHLIGHTS_START + '\n';
        highlights.forEach(h => {
            section += `## ${h.date} @${h.author}\n`;
            section += (h.content || '').replace(/\n+$/, '') + '\n\n';
        });
        section = section.replace(/\n+$/, '');
        section += '\n\n' + HIGHLIGHTS_END;
        result = base + '\n\n---\n\n' + section;
    }

    // Re-append sections in canonical order: budget, benefits, raid, comms, lessons, baseline, whiteboard
    if (budgetText) {
        result = result.replace(/\n+$/, '') + '\n\n' + BUDGET_START + '\n' + budgetText;
    }
    if (benefitsText) {
        result = result.replace(/\n+$/, '') + '\n\n---benefits---\n' + benefitsText;
    }
    if (raidText) {
        result = result.replace(/\n+$/, '') + '\n\n' + RAID_LOG_START + '\n' + raidText;
    }
    if (commsText) {
        result = result.replace(/\n+$/, '') + '\n\n' + COMMS_START + '\n' + commsText;
    }
    if (lessonsText) {
        result = result.replace(/\n+$/, '') + '\n\n' + LESSONS_START + '\n' + lessonsText;
    }
    if (baselineText) {
        result = result.replace(/\n+$/, '') + '\n\n' + BASELINE_START + '\n' + baselineText;
    }
    if (whiteboardText) {
        result = result.replace(/\n+$/, '') + '\n\n' + WHITEBOARD_START + '\n' + whiteboardText;
    }

    return result;
}

// ============================================================
// Task Inspector
// ============================================================

/**
 * Open the Task Inspector for the task on the current editor line.
 * Determines the line number from the cursor position in the plan editor.
 */
function openTaskInspectorForCurrentLine() {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const cursorPos = editor.selectionStart;
    const textBefore = editor.value.substring(0, cursorPos);
    const lineNumber = textBefore.split('\n').length;

    openTaskInspector(lineNumber);
}

/**
 * Open the Task Inspector for a given task by its editor line number.
 */
function openTaskInspector(lineNumber) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const lines = editor.value.split('\n');
    const taskLine = lines[lineNumber - 1];
    if (!taskLine || !taskLine.trim()) {
        showInspectorEmpty('No task found on this line. Place your cursor on a task line and try again.');
        openDetailPane('taskInspectorSection');
        return;
    }

    // Parse the current task
    const task = parseTaskLine(taskLine, lineNumber);
    if (!task.name) {
        showInspectorEmpty('This line does not contain a recognisable task. Check the syntax and try again.');
        openDetailPane('taskInspectorSection');
        return;
    }

    // Build task map for dependency resolution
    const taskMap = new Map();
    for (let i = 0; i < lines.length; i++) {
        const t = parseTaskLine(lines[i], i + 1);
        if (t.name) {
            taskMap.set(t.name, t);
        }
    }

    // Calculate dates (recursive dependency resolution)
    calculateTaskDates(task, taskMap, lines);

    // Calculate RAG info
    const ragInfo = calculateInspectorRag(task);

    // Find dependency details
    const depDetails = getInspectorDependencies(task, taskMap, lines);

    // Generate hints
    const hints = generateInspectorHints(task, ragInfo, depDetails);

    // Render the inspector
    renderTaskInspector(task, ragInfo, depDetails, hints, lineNumber);
    openDetailPane('taskInspectorSection');
}

/**
 * Open the Task Inspector for a task specified by name.
 * Finds the task in the editor and opens the inspector for it.
 */
function openTaskInspectorByName(taskName) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const lines = editor.value.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const t = parseTaskLine(lines[i], i + 1);
        if (t.name && t.name === taskName) {
            openTaskInspector(i + 1);
            return;
        }
    }
}

function openTaskInspectorByDeliverable(deliverableId) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const token = '$' + deliverableId;
    const lines = editor.value.split('\n');
    for (let i = 0; i < lines.length; i++) {
        // Match the $token on this line (not inside [depends])
        const lineWithoutDepends = lines[i].replace(/\[depends(?::\s*|\s+)[^\]]*\]/gi, '');
        if (lineWithoutDepends.includes(token)) {
            openTaskInspector(i + 1);
            return;
        }
    }
}

function closeTaskInspector() {
    closeDetailPane();
}

document.getElementById('inspectorPanelHeader')?.addEventListener('close', closeTaskInspector);

function showInspectorEmpty(message) {
    const body = document.getElementById('inspectorBody');
    const header = document.getElementById('inspectorPanelHeader');
    header.setAttribute('title', 'Task Inspector');
    body.innerHTML = '<div class="inspector-empty-state"><p>' + escapeHtml(message) + '</p></div>';
}

/**
 * Calculate RAG status and reasoning for the inspector.
 * Returns { status, reasoning, bgClass, expectedPercent }
 */
function calculateInspectorRag(task) {
    const percent = parseInt(task.percent) || 0;
    const startDateStr = task.startDate;
    const finishDateStr = task.finishDate;
    const deadlineStr = task.deadline;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let status, reasoning, bgClass, expectedPercent = null;

    if (percent === 100) {
        status = 'Complete';
        bgClass = 'rag-blue';
        reasoning = 'This task is complete. No further action needed.';
    } else if (deadlineStr && (
        new Date(deadlineStr) < today ||
        (finishDateStr && new Date(finishDateStr) > new Date(deadlineStr))
    )) {
        // Red: deadline slippage (#877). A fixed marker, independent of the
        // on-track/behind-schedule reasoning below. Mirrors
        // exporters.calculate_rag_status in noodle_core.
        status = 'Task Overdue';
        bgClass = 'rag-red';
        reasoning = new Date(deadlineStr) < today
            ? 'This task has a deadline of ' + formatInspectorDate(deadlineStr) + ', which has passed, and the task is not complete.'
            : 'This task is not on track to complete by its deadline of ' + formatInspectorDate(deadlineStr) + '.';
    } else if (startDateStr && new Date(startDateStr) > today) {
        status = 'Not Started';
        bgClass = 'rag-green';
        const startDate = new Date(startDateStr);
        const daysUntil = Math.ceil((startDate - today) / (1000 * 60 * 60 * 24));
        reasoning = 'This task is not due to start yet. It begins in ' + daysUntil + ' day' + (daysUntil !== 1 ? 's' : '') + ' on ' + formatInspectorDate(startDateStr) + '.';
    } else if (startDateStr && new Date(startDateStr) <= today && percent === 0) {
        status = 'Task Overdue';
        bgClass = 'rag-red';
        const startDate = new Date(startDateStr);
        const daysOverdue = Math.ceil((today - startDate) / (1000 * 60 * 60 * 24));
        reasoning = 'This task was scheduled to start ' + daysOverdue + ' day' + (daysOverdue !== 1 ? 's' : '') + ' ago but has no progress reported. It needs immediate attention.';
    } else if (startDateStr && finishDateStr) {
        const startDate = new Date(startDateStr);
        const finishDate = new Date(finishDateStr);
        const totalDuration = (finishDate - startDate) / (1000 * 60 * 60 * 24);
        const elapsedDays = Math.max(0, (today - startDate) / (1000 * 60 * 60 * 24));
        expectedPercent = Math.min(100, Math.round((elapsedDays / Math.max(1, totalDuration)) * 100));

        if (today > finishDate && percent < 100) {
            status = 'Task Overdue';
            bgClass = 'rag-red';
            const daysLate = Math.ceil((today - finishDate) / (1000 * 60 * 60 * 24));
            reasoning = 'This task is ' + daysLate + ' day' + (daysLate !== 1 ? 's' : '') + ' past its finish date with only ' + percent + '% complete. It is overdue and blocking downstream work.';
        } else if (percent < expectedPercent) {
            status = 'Behind Schedule';
            bgClass = 'rag-amber';
            const gap = expectedPercent - percent;
            reasoning = 'This task is behind schedule. Based on elapsed time, it should be around ' + expectedPercent + '% complete but is only at ' + percent + '%. There is a ' + gap + ' percentage point gap to close.';
        } else {
            status = 'On Track';
            bgClass = 'rag-green';
            reasoning = 'This task is on track. It is ' + percent + '% complete against an expected ' + expectedPercent + '%.';
        }
    } else if (percent === 0) {
        status = 'Task Overdue';
        bgClass = 'rag-red';
        reasoning = 'No progress has been reported for this task and no schedule dates are available.';
    } else if (percent < 50) {
        status = 'Task Overdue';
        bgClass = 'rag-red';
        reasoning = 'Progress is below 50% and no schedule dates are available to assess whether this is on track.';
    } else if (percent < 80) {
        status = 'Behind Schedule';
        bgClass = 'rag-amber';
        reasoning = 'Progress is between 50% and 80%. Without schedule dates, it is hard to confirm this is on track.';
    } else {
        status = 'On Track';
        bgClass = 'rag-green';
        reasoning = 'Progress is at ' + percent + '%, which indicates the task is nearing completion.';
    }

    return { status, reasoning, bgClass, expectedPercent };
}

/**
 * Build dependency detail list for the inspector.
 * Returns an array of { name, finishDate, isDriving, lineNumber }
 */
function getInspectorDependencies(task, taskMap, lines) {
    if (!task.dependencies) return [];

    const depEntries = task.dependencies.split(',').map(d => d.trim()).filter(d => d);
    const results = [];

    let latestFinishDate = null;

    // Helper to strip dependency type and lag/lead from an entry to get the task name and type
    function extractDepInfo(entry) {
        const lagLeadMatch = entry.match(/^(.+?)\s+[+\-]\d+[dwmy]$/);
        let corePart = lagLeadMatch ? lagLeadMatch[1].trim() : entry;
        const typeMatch = corePart.match(/^(.+?):(FS|SS|FF|SF)$/i);
        const name = typeMatch ? typeMatch[1].trim() : corePart;
        const depType = typeMatch ? typeMatch[2].toUpperCase() : 'FS';
        return { name, depType };
    }

    // First pass: find the latest effective date (the driving dependency)
    // For SS/SF types, use startDate; for FS/FF types, use finishDate
    let latestEffectiveDate = null;
    for (const depEntry of depEntries) {
        const { name: depName, depType } = extractDepInfo(depEntry);
        const depTask = taskMap.get(depName);

        if (depTask) {
            calculateTaskDates(depTask, taskMap, lines);
            const refDate = (depType === 'SS' || depType === 'SF') ? depTask.startDate : depTask.finishDate;
            if (refDate) {
                if (!latestEffectiveDate || refDate > latestEffectiveDate) {
                    latestEffectiveDate = refDate;
                }
            }
        }
    }

    // Second pass: build details and mark the driving dependency
    for (const depEntry of depEntries) {
        const { name: depName, depType } = extractDepInfo(depEntry);
        const depTask = taskMap.get(depName);
        const refDate = depTask
            ? ((depType === 'SS' || depType === 'SF') ? depTask.startDate : depTask.finishDate)
            : null;

        const detail = {
            name: depName,
            depType: depType,
            refDate: refDate || null,
            finishDate: depTask ? (depTask.finishDate || null) : null,
            isDriving: false,
            lineNumber: null,
            rag: null
        };

        if (depTask) {
            detail.lineNumber = depTask.lineNumber || null;
            detail.isDriving = (refDate && refDate === latestEffectiveDate);

            // Calculate dep RAG
            const depRag = calculateInspectorRag(depTask);
            detail.rag = depRag.status;
        }

        results.push(detail);
    }

    return results;
}

/**
 * Generate actionable hints for the project manager.
 */
function generateInspectorHints(task, ragInfo, depDetails) {
    const hints = [];
    const percent = parseInt(task.percent) || 0;

    // Hint for red tasks
    if (ragInfo.status === 'Task Overdue') {
        if (percent === 0 && task.startDate) {
            hints.push('This task has not started despite being past its start date. Check with the assigned resource to confirm availability and remove any blockers.');
        }
        if (ragInfo.expectedPercent !== null && ragInfo.expectedPercent > percent) {
            hints.push('Consider re-planning: can additional resources be allocated, or should the scope be reduced to bring this back on track?');
        }
        if (!task.resources) {
            hints.push('No resources are assigned to this task. Assigning an owner will help ensure accountability.');
        }
    }

    // Hint for amber tasks
    if (ragInfo.status === 'Behind Schedule') {
        hints.push('This task is falling behind. A short check-in with the assigned resource may uncover issues early before the situation worsens.');
        if (ragInfo.expectedPercent !== null) {
            const gap = ragInfo.expectedPercent - percent;
            if (gap > 20) {
                hints.push('The progress gap is significant (' + gap + '%). Consider whether the task estimate was realistic or if there are hidden blockers.');
            }
        }
    }

    // Hints about dependencies
    const redDeps = depDetails.filter(d => ragStatusToColour(d.rag) === 'red');
    const amberDeps = depDetails.filter(d => ragStatusToColour(d.rag) === 'amber');

    if (redDeps.length > 0) {
        const names = redDeps.map(d => d.name).join(', ');
        hints.push('Upstream dependency "' + names + '" is flagged red. This task cannot truly begin until its dependencies are resolved.');
    }

    if (amberDeps.length > 0 && redDeps.length === 0) {
        const names = amberDeps.map(d => d.name).join(', ');
        hints.push('Upstream dependency "' + names + '" is at amber status. Monitor closely to avoid knock-on delays to this task.');
    }

    // Hint for tasks with no dependencies and no dates
    if (depDetails.length === 0 && !task.startDate && !task.finishDate) {
        hints.push('This task has no dependencies or dates set. Adding start/finish dates or linking it to predecessor tasks will improve schedule accuracy.');
    }

    // Hint for completed tasks
    if (percent === 100 && ragInfo.status === 'Complete') {
        hints.push('This task is complete. Well done!');
    }

    return hints;
}

/**
 * Format a date string (YYYY-MM-DD) into a readable format.
 */
function formatInspectorDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
        return dateStr;
    }
}

/**
 * Render the full Task Inspector content.
 */
function renderTaskInspector(task, ragInfo, depDetails, hints, lineNumber) {
    currentInspectorLineNumber = lineNumber;
    const header = document.getElementById('inspectorPanelHeader');
    const body = document.getElementById('inspectorBody');

    header.setAttribute('title', task.name || 'Task Inspector');

    const percent = parseInt(task.percent) || 0;
    const durationText = task.duration ? task.duration + ' day' + (task.duration !== '1' ? 's' : '') : '-';
    const resourcesText = task.resources || 'Unassigned';
    const priorityText = task.priority || 'Low';

    // Determine progress bar colour
    let progressColour = ragStatusToColour(ragInfo.status) || 'green';
    if (progressColour === 'blue') progressColour = 'green'; // Complete tasks use green bar

    let html = '';

    // --- RAG Banner ---
    html += '<div class="inspector-rag-banner ' + ragInfo.bgClass + '">';
    html += '  <div class="inspector-rag-dot ' + ragInfo.bgClass + '"></div>';
    html += '  <div class="inspector-rag-text">';
    html += '    <div class="inspector-rag-status">' + escapeHtml(ragInfo.status) + ' Status</div>';
    html += '    <div class="inspector-rag-explanation">' + escapeHtml(ragInfo.reasoning) + '</div>';
    html += '  </div>';
    html += '</div>';

    // --- Schedule & Details ---
    html += '<div class="inspector-section">';
    html += '  <div class="inspector-section-header"><span class="inspector-icon">📅</span> Schedule &amp; Details</div>';
    html += '  <div class="inspector-section-body">';
    html += '    <div class="inspector-field-grid">';
    html += '      <div class="inspector-field">';
    html += '        <div class="inspector-field-label">Start Date</div>';
    html += '        <div class="inspector-field-value">' + formatInspectorDate(task.startDate) + '</div>';
    html += '      </div>';
    html += '      <div class="inspector-field">';
    html += '        <div class="inspector-field-label">Finish Date</div>';
    html += '        <div class="inspector-field-value">' + formatInspectorDate(task.finishDate) + '</div>';
    html += '      </div>';
    if (task.deadline) {
        html += '      <div class="inspector-field">';
        html += '        <div class="inspector-field-label">Deadline</div>';
        html += '        <div class="inspector-field-value">' + formatInspectorDate(task.deadline) + '</div>';
        html += '      </div>';
    }
    html += '      <div class="inspector-field">';
    html += '        <div class="inspector-field-label">Duration</div>';
    html += '        <div class="inspector-field-value">' + escapeHtml(durationText) + '</div>';
    html += '      </div>';
    html += '      <div class="inspector-field">';
    html += '        <div class="inspector-field-label">Priority</div>';
    html += '        <div class="inspector-field-value">' + escapeHtml(priorityText) + '</div>';
    html += '      </div>';
    html += '      <div class="inspector-field">';
    html += '        <div class="inspector-field-label">Resources</div>';
    html += '        <div class="inspector-field-value">' + escapeHtml(resourcesText) + '</div>';
    html += '      </div>';
    html += '      <div class="inspector-field">';
    html += '        <div class="inspector-field-label">Bucket</div>';
    html += '        <div class="inspector-field-value">' + escapeHtml(task.bucket || '-') + '</div>';
    html += '      </div>';
    html += '    </div>';

    // Progress bar
    html += '    <div class="inspector-field" style="margin-top: 6px;">';
    html += '      <div class="inspector-field-label">Progress: ' + percent + '%</div>';
    html += '      <div class="inspector-progress-bar-wrapper">';
    html += '        <div class="inspector-progress-bar-fill ' + progressColour + '" style="width: ' + percent + '%;"></div>';
    html += '      </div>';
    html += '    </div>';

    if (ragInfo.expectedPercent !== null && percent < 100) {
        html += '    <div style="font-size: 0.82em; color: var(--np-faint); margin-top: 4px;">Expected progress based on elapsed time: ' + ragInfo.expectedPercent + '%</div>';
    }

    html += '  </div>';
    html += '</div>';

    // --- Dependencies ---
    html += '<div class="inspector-section">';
    html += '  <div class="inspector-section-header"><span class="inspector-icon">🔗</span> Dependencies (What Drives the Start Date)</div>';
    html += '  <div class="inspector-section-body">';

    if (depDetails.length === 0) {
        html += '    <div class="inspector-no-deps">This task has no dependencies. Its start date is set directly or defaults to today.</div>';
    } else {
        html += '    <ul class="inspector-dep-list">';
        for (const dep of depDetails) {
            html += '      <li class="inspector-dep-item">';
            html += '        <span class="inspector-dep-badge ' + (dep.isDriving ? 'driving' : 'non-driving') + '">';
            html += dep.isDriving ? 'DRIVING' : 'predecessor';
            html += '        </span>';
            html += '        <span class="inspector-dep-name">';
            if (dep.lineNumber) {
                html += '<a href="#" onclick="openTaskInspectorByName(\'' + escapeHtml(dep.name).replace(/'/g, "\\'") + '\'); return false;" style="color: inherit; text-decoration: underline dotted;">';
                html += escapeHtml(dep.name);
                html += '</a>';
            } else {
                html += escapeHtml(dep.name);
            }
            html += '        </span>';
            const depTypeLabel = dep.depType === 'SS' ? 'starts' : dep.depType === 'SF' ? 'starts' : dep.depType === 'FF' ? 'finishes' : 'finishes';
            const depRefDate = dep.refDate || dep.finishDate;
            html += '        <span class="inspector-dep-date">' + depTypeLabel + ' ' + formatInspectorDate(depRefDate) + '</span>';
            if (dep.rag) {
                const depRagCol = ragStatusToColour(dep.rag);
                html += '        <span class="inspector-rag-dot' + (depRagCol ? ' rag-' + depRagCol : '') + '" style="width:10px; height:10px;" title="' + escapeHtml(dep.rag) + '"></span>';
            }
            html += '      </li>';
        }
        html += '    </ul>';

        // Explain the driving dependency
        const drivingDep = depDetails.find(d => d.isDriving);
        if (drivingDep) {
            html += '    <div style="font-size: 0.85em; color: var(--np-body); margin-top: 8px;">';
            const drivingRefDate = drivingDep.refDate || drivingDep.finishDate;
            const drivingVerb = (drivingDep.depType === 'SS' || drivingDep.depType === 'SF') ? 'starting' : 'finishing';
            const drivingRelation = drivingDep.depType === 'SS' ? 'start when it starts'
                : drivingDep.depType === 'FF' ? 'finish when it finishes'
                : drivingDep.depType === 'SF' ? 'finish when it starts'
                : 'start after it finishes';
            html += '      The <strong>driving dependency</strong> is "' + escapeHtml(drivingDep.name) + '", ' + drivingVerb + ' on ' + formatInspectorDate(drivingRefDate) + '. ';
            html += '      This task will ' + drivingRelation + '.';
            if (depDetails.length > 1) {
                html += ' The other predecessor' + (depDetails.length > 2 ? 's are' : ' is') + ' expected to finish earlier and ' + (depDetails.length > 2 ? 'do' : 'does') + ' not affect the start date.';
            }
            html += '    </div>';
        }
    }

    html += '  </div>';
    html += '</div>';

    // --- Estimate (#1053) ---
    html += '<div class="inspector-section">';
    html += '  <div class="inspector-section-header"><span class="inspector-icon">🎯</span> Estimate</div>';
    html += '  <div class="inspector-section-body">';
    html += '    <button type="button" class="estimate-open-btn" id="inspectorEstimateBtn">Three-point estimate…</button>';
    html += '  </div>';
    html += '</div>';

    // --- Cards (#1050) ---
    html += '<div class="inspector-section">';
    html += '  <div class="inspector-section-header"><span class="inspector-icon">📇</span> Snippets</div>';
    html += '  <div class="inspector-section-body">';
    html += '    <p class="inspector-help-text">Save this task and its sub-tasks as a reusable outline fragment.</p>';
    html += '    <button type="button" class="estimate-open-btn" id="inspectorCardsBtn">Save / insert snippet…</button>';
    html += '  </div>';
    html += '</div>';

    // --- Comment ---
    if (task.comment) {
        html += '<div class="inspector-section">';
        html += '  <div class="inspector-section-header"><span class="inspector-icon">💬</span> Comment</div>';
        html += '  <div class="inspector-section-body">';
        html += '    <div style="font-size: 0.9em; color: var(--np-body); line-height: 1.5;">' + escapeHtml(task.comment) + '</div>';
        html += '  </div>';
        html += '</div>';
    }

    // --- Hints ---
    if (hints.length > 0) {
        html += '<div class="inspector-section">';
        html += '  <div class="inspector-section-header"><span class="inspector-icon">💡</span> Recommendations</div>';
        html += '  <div class="inspector-section-body">';
        for (const hint of hints) {
            html += '    <div class="inspector-hint">' + escapeHtml(hint) + '</div>';
        }
        html += '  </div>';
        html += '</div>';
    }

    // Edit button is now in the inspector header — no inline button needed

    body.innerHTML = html;

    const estimateBtn = document.getElementById('inspectorEstimateBtn');
    if (estimateBtn && typeof EstimatingTool !== 'undefined') {
        estimateBtn.addEventListener('click', () => {
            const editor = document.getElementById('planEditor');
            if (!editor) return;
            EstimatingTool.openEstimatePopup({
                getText: () => editor.value,
                setText: (text) => {
                    editor.value = text;
                    editor.dispatchEvent(new Event('input', { bubbles: true }));
                    openTaskInspectorByName(task.name);
                },
                taskName: task.name,
            });
        });
    }

    const cardsBtn = document.getElementById('inspectorCardsBtn');
    if (cardsBtn && typeof CardLibrary !== 'undefined') {
        cardsBtn.addEventListener('click', () => openCardLibraryForTask(task));
    }
}


// ==============================================================================
// ACTIONS TRACKER SYSTEM
// ==============================================================================

// Note: Actions are stored in the global raidItems array with type='action'
// Actions state is now in state.js

/**
 * Get all action items from RAID log
 */
function getActionItems() {
    return raidItems.filter(item => item.type === 'action');
}

/**
 * Clear actions entries from the UI and global state
 */
function clearActionsEntries() {
    // Remove all action-type items from raidItems
    raidItems = raidItems.filter(item => item.type !== 'action');
    renderActionsTable();
    renderRaidTable(); // Update RAID table as well
    console.log('Cleared actions entries');
}

/**
 * Add a new action
 */
function addAction() {
    openActionForm(null);
}

/**
 * Open the action form for creating or editing
 */
function openActionForm(itemId) {
    const title = document.getElementById('actionFormTitle');
    const idField = document.getElementById('actionItemId');

    if (itemId != null) {
        const item = raidItems.find(i => i.id === itemId && i.type === 'action');
        if (!item) return;

        title.textContent = 'Edit Action';
        idField.value = item.id;
        document.getElementById('actionItemTitle').value = item.title || '';
        document.getElementById('actionItemDescription').value = item.description || item.mitigation_actions || '';
        document.getElementById('actionItemOwner').value = item.owner || '';
        document.getElementById('actionItemResource').value = item.resource || item.raised_by || '';
        document.getElementById('actionItemStatus').value = item.status || 'open';
        document.getElementById('actionItemPriority').value = item.priority || 'medium';
        document.getElementById('actionItemTargetDate').value = item.target_date || item.date || '';
    } else {
        title.textContent = 'New Action';
        idField.value = '';
        document.getElementById('actionItemTitle').value = '';
        document.getElementById('actionItemDescription').value = '';
        document.getElementById('actionItemOwner').value = '';
        document.getElementById('actionItemResource').value = '';
        document.getElementById('actionItemStatus').value = 'open';
        document.getElementById('actionItemPriority').value = 'medium';
        document.getElementById('actionItemTargetDate').value = '';
    }

    openDetailPane('actionFormSection');
}

/**
 * Close the action form
 */
function closeActionForm() {
    closeDetailPane();
}

/**
 * Save action from form
 */
function saveActionFromForm() {
    const idField = document.getElementById('actionItemId').value;
    const title = document.getElementById('actionItemTitle').value.trim();

    if (!title) {
        alert('Please enter a title for the action.');
        return;
    }

    const description = document.getElementById('actionItemDescription').value.trim();
    const owner = document.getElementById('actionItemOwner').value.trim();
    const resource = document.getElementById('actionItemResource').value.trim();
    const status = document.getElementById('actionItemStatus').value;
    const priority = document.getElementById('actionItemPriority').value;
    const targetDate = document.getElementById('actionItemTargetDate').value;

    // Map action fields to RAID item structure
    const itemData = {
        type: 'action',
        title: title,
        description: description,
        mitigation_actions: description,  // Store in mitigation_actions for RAID log
        owner: owner,
        raised_by: resource,  // Store resource in raised_by for RAID log
        resource: resource,
        status: status,
        priority: priority,
        target_date: targetDate,
        date: targetDate,  // Store in date field for RAID log compatibility
        impact: 1,  // Default values for RAID log compatibility
        likelihood: 1,
        score: 1
    };

    if (idField) {
        // Update existing
        const existingId = parseInt(idField);
        const index = raidItems.findIndex(i => i.id === existingId && i.type === 'action');
        if (index >= 0) {
            raidItems[index] = { ...raidItems[index], ...itemData };
        }
    } else {
        // Create new
        itemData.id = raidNextId++;
        raidItems.push(itemData);
    }

    closeActionForm();
    renderActionsTable();
    updateReportActions();
    updateResourceFilter();
    renderRaidTable(); // Update RAID table as well
    syncRaidLogToPlanText(); // Save to plan text
}

/**
 * Delete an action
 */
function deleteAction(id) {
    if (!confirm('Are you sure you want to delete this action?')) return;
    raidItems = raidItems.filter(i => !(i.id === id && i.type === 'action'));
    renderActionsTable();
    updateReportActions();
    updateResourceFilter();
    renderRaidTable(); // Update RAID table as well
    syncRaidLogToPlanText(); // Save to plan text
}

/**
 * Render the actions table view
 */
function renderActionsTable() {
    try {
        const tbody = document.getElementById('actionsTableBody');
        const emptyState = document.getElementById('actionsEmptyState');
        if (!tbody || !emptyState) {
            console.warn('Actions table elements not found in DOM');
            return;
        }

        const filterStatusEl = document.getElementById('actionsFilterStatus');
        const filterResourceEl = document.getElementById('actionsFilterResource');
        const filterPriorityEl = document.getElementById('actionsFilterPriority');
        const filterStatus = filterStatusEl ? filterStatusEl.value : 'all';
        const filterResource = filterResourceEl ? filterResourceEl.value : 'all';
        const filterPriority = filterPriorityEl ? filterPriorityEl.value : 'all';

        const actionItems = getActionItems();

        let filtered = actionItems.filter(item => {
            if (filterStatus !== 'all' && item.status !== filterStatus) return false;
            const itemResource = item.resource || item.raised_by || '';
            if (filterResource !== 'all' && itemResource !== filterResource) return false;
            if (filterPriority !== 'all' && item.priority !== filterPriority) return false;
            return true;
        });

        filtered.sort((a, b) => {
            let valA = a[actionsSortColumn];
            let valB = b[actionsSortColumn];

            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();

            if (valA < valB) return actionsSortAsc ? -1 : 1;
            if (valA > valB) return actionsSortAsc ? 1 : -1;
            return 0;
        });

        tbody.innerHTML = '';

        if (actionItems.length === 0) {
            emptyState.hidden = false;
            document.getElementById('actionsTable').style.display = 'none';
            return;
        }

        emptyState.hidden = true;
        document.getElementById('actionsTable').style.display = 'table';

        filtered.forEach(item => {
            const row = document.createElement('tr');

            const priorityClass = 'actions-priority-' + (item.priority || 'medium');
            const statusClass = 'actions-status-' + (item.status || 'open');
            const description = item.description || item.mitigation_actions || '';
            const resource = item.resource || item.raised_by || '';
            const targetDate = item.target_date || item.date || '';

            row.innerHTML = '<td>' + (item.id || '') + '</td>' +
                '<td title="' + escapeHtml(item.title) + '">' + escapeHtml(item.title) + '</td>' +
                '<td title="' + escapeHtml(description) + '">' + escapeHtml(description) + '</td>' +
                '<td>' + escapeHtml(item.owner || '') + '</td>' +
                '<td>' + escapeHtml(resource) + '</td>' +
                '<td><span class="actions-priority-badge ' + priorityClass + '">' + (item.priority || 'medium') + '</span></td>' +
                '<td>' + targetDate + '</td>' +
                '<td><span class="actions-status-badge ' + statusClass + '">' + (item.status || 'open') + '</span></td>' +
                '<td>' +
                    '<np-button icon-only variant="primary" size="medium" title="Edit" label="Edit" onclick="openActionForm(' + item.id + ')"><span slot="icon">✏️</span></np-button>' +
                    '<np-button icon-only variant="danger" size="medium" title="Delete" label="Delete" onclick="deleteAction(' + item.id + ')"><span slot="icon">🗑️</span></np-button>' +
                '</td>';
            tbody.appendChild(row);
        });

        updateActionsSortIndicators();
    } catch (error) {
        console.error('Error rendering actions table:', error);
    }
}

/**
 * Sort actions table
 */
function sortActionsTable(column) {
    if (actionsSortColumn === column) {
        actionsSortAsc = !actionsSortAsc;
    } else {
        actionsSortColumn = column;
        actionsSortAsc = true;
    }
    renderActionsTable();
}

/**
 * Update sort indicators
 */
function updateActionsSortIndicators() {
    const headers = document.querySelectorAll('.actions-table th');
    headers.forEach(th => {
        const indicator = th.querySelector('.sort-indicator');
        if (indicator) {
            const onclick = th.getAttribute('onclick');
            if (onclick && onclick.includes("'" + actionsSortColumn + "'")) {
                indicator.textContent = actionsSortAsc ? '▲' : '▼';
            } else {
                indicator.textContent = '';
            }
        }
    });
}

/**
 * Update resource filter dropdown
 */
function updateResourceFilter() {
    const filterEl = document.getElementById('actionsFilterResource');
    if (!filterEl) return;

    const resources = new Set();
    const actionItems = getActionItems();
    actionItems.forEach(item => {
        const resource = item.resource || item.raised_by || '';
        if (resource) resources.add(resource);
    });

    const currentValue = filterEl.value;
    filterEl.innerHTML = '<option value="all">All</option>';
    Array.from(resources).sort().forEach(resource => {
        const option = document.createElement('option');
        option.value = resource;
        option.textContent = resource;
        filterEl.appendChild(option);
    });
    filterEl.value = currentValue;
}

/**
 * Update report actions table
 */
function updateReportActions() {
    const tbody = document.getElementById('reportActionsTableBody');
    const emptyState = document.getElementById('reportActionsEmpty');
    const table = document.getElementById('reportActionsTable');

    if (!tbody || !emptyState || !table) return;

    const actionItems = getActionItems();
    const openActions = actionItems.filter(a => a.status === 'open');

    tbody.innerHTML = '';

    if (openActions.length === 0) {
        table.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    table.style.display = 'table';
    emptyState.style.display = 'none';

    openActions.forEach(action => {
        const row = document.createElement('tr');
        row.style.cursor = 'pointer';
        row.title = 'Click to view details';
        row.addEventListener('click', () => openActionForm(action.id));

        const priorityClass = 'actions-priority-' + (action.priority || 'medium');
        const targetDate = action.target_date || action.date || '';

        row.innerHTML = '<td>' + escapeHtml(action.title || '') + '</td>' +
            '<td>' + escapeHtml(action.owner || '') + '</td>' +
            '<td><span class="actions-priority-badge ' + priorityClass + '">' + (action.priority || 'medium') + '</span></td>' +
            '<td>' + targetDate + '</td>';
        tbody.appendChild(row);
    });
}

/**
 * Export actions to Excel
 */
async function exportActionsExcel() {
    try {
        const response = await fetch('/api/actions/export-excel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                items: actionsItems,
                project_name: 'Project'
            })
        });

        if (!response.ok) {
            throw new Error('Export failed');
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'actions.xlsx';
        a.click();
        window.URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Error exporting actions:', error);
        alert('Failed to export actions to Excel');
    }
}

/**
 * Upload actions from Excel
 */
async function uploadActionsExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/actions/import-excel', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error('Import failed');
        }

        const data = await response.json();
        if (data.items) {
            actionsItems = data.items;
            actionsNextId = Math.max(...actionsItems.map(i => i.id || 0), 0) + 1;
            renderActionsTable();
            updateReportActions();
            updateResourceFilter();
        }
    } catch (error) {
        console.error('Error importing actions:', error);
        alert('Failed to import actions from Excel');
    }

    // Reset file input
    event.target.value = '';
}

/* ========================================
 * Keyboard Shortcuts Modal
 * ======================================== */

function openShortcutsModal() {
    const overlay = document.getElementById('shortcutsOverlay');
    if (overlay) {
        overlay.classList.add('active');
        // Focus the close button for screen readers
        const closeBtn = overlay.querySelector('np-close-button');
        if (closeBtn) closeBtn.focus();
    }
}

function closeShortcutsModal() {
    const overlay = document.getElementById('shortcutsOverlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
}

// ============================================================================
// KEYBOARD SHORTCUTS
// ============================================================================

/**
 * Check if the user is currently typing in a text input, textarea, or
 * contenteditable element. Keyboard shortcuts should not fire in these cases.
 */
function isTypingInInput(element) {
    if (!element) return false;
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'input' && element.type !== 'checkbox' && element.type !== 'radio') {
        return true;
    }
    if (tagName === 'textarea') {
        return true;
    }
    if (element.isContentEditable) {
        return true;
    }
    return false;
}

/**
 * Show the keyboard shortcuts help modal.
 */
function showKeyboardShortcuts() {
    const overlay = document.getElementById('keyboardShortcutsOverlay');
    if (overlay) {
        overlay.classList.add('active');
    }
}

/**
 * Close the keyboard shortcuts help modal.
 */
function closeKeyboardShortcuts() {
    const overlay = document.getElementById('keyboardShortcutsOverlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
}

/* ========================================
 * Global Keyboard Shortcuts
 * ======================================== */

// Keyboard shortcut state is now in state.js

document.addEventListener('keydown', function(e) {
    // Don't trigger shortcuts when typing in inputs/textareas
    const tag = (e.target.tagName || '').toLowerCase();
    const isEditable = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;

    // '?' key opens shortcuts modal (only from non-input contexts)
    if (e.key === '?' && !isEditable) {
        e.preventDefault();
        const overlay = document.getElementById('shortcutsOverlay');
        if (overlay && overlay.classList.contains('active')) {
            closeShortcutsModal();
        } else {
            openShortcutsModal();
        }
        return;
    }

    // Escape closes shortcuts modal
    if (e.key === 'Escape') {
        const overlay = document.getElementById('shortcutsOverlay');
        if (overlay && overlay.classList.contains('active')) {
            closeShortcutsModal();
            return;
        }
    }

    // Escape closes the status message log
    if (e.key === 'Escape') {
        const statusLogOverlay = document.getElementById('statusLogOverlay');
        if (statusLogOverlay && statusLogOverlay.classList.contains('active')) {
            closeStatusLogFullscreen();
            return;
        }
    }

    // 'g' then letter navigation (only from non-input contexts)
    if (!isEditable && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === 'g' && !pendingGoKey) {
            pendingGoKey = true;
            clearTimeout(goKeyTimeout);
            goKeyTimeout = setTimeout(() => { pendingGoKey = false; }, 800);
            return;
        }

        if (pendingGoKey) {
            pendingGoKey = false;
            clearTimeout(goKeyTimeout);

            switch (e.key) {
                case 'd': switchToView('project-report'); break;
                case 't': switchToView('tasks'); break;
                case 'g': switchToView('gantt'); break;
                case 'c': switchToView('calendar'); break;
                case 'b': switchPlanSubnavToBoard(); break;
                case 'l': switchToView('timeline'); break;
            }
            return;
        }
    }
});

/* ========================================
 * Navigation Menu Keyboard Support
 * Arrow keys, Enter, Escape within dropdown menus.
 * ======================================== */

function initMenuKeyboardNav() {
    // Support both old .nav-dropdown (if any remain) and new .plan-subnav-dropdown
    const dropdowns = document.querySelectorAll('.nav-dropdown, .plan-subnav-dropdown');

    dropdowns.forEach(dropdown => {
        const trigger = dropdown.querySelector('.tab, .plan-subnav-btn[aria-haspopup]');
        const menu = dropdown.querySelector('.nav-menu');
        if (!trigger || !menu) return;

        // Set role and tabindex on menu items
        const items = menu.querySelectorAll('.nav-menu-item');
        items.forEach(item => {
            item.setAttribute('role', 'menuitem');
            item.setAttribute('tabindex', '-1');
        });

        // Open menu on Enter/Space and arrow-down when trigger is focused
        trigger.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
                e.preventDefault();
                trigger.click();
                // Focus the first menu item after the menu opens
                setTimeout(() => {
                    const firstItem = menu.querySelector('.nav-menu-item');
                    if (firstItem) firstItem.focus();
                }, 50);
            }
        });

        // Arrow key navigation within menu
        menu.addEventListener('keydown', function(e) {
            const visibleItems = Array.from(menu.querySelectorAll('.nav-menu-item')).filter(
                item => item.offsetParent !== null && !item.classList.contains('nav-menu-divider')
            );
            const currentIndex = visibleItems.indexOf(document.activeElement);

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                const next = currentIndex < visibleItems.length - 1 ? currentIndex + 1 : 0;
                visibleItems[next].focus();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const prev = currentIndex > 0 ? currentIndex - 1 : visibleItems.length - 1;
                visibleItems[prev].focus();
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (document.activeElement && document.activeElement.classList.contains('nav-menu-item')) {
                    document.activeElement.click();
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                menu.classList.remove('show');
                trigger.setAttribute('aria-expanded', 'false');
                trigger.focus();
            } else if (e.key === 'Tab') {
                menu.classList.remove('show');
                trigger.setAttribute('aria-expanded', 'false');
            }
        });
    });
}

/* ========================================
 * Sync aria-expanded on menu toggle
 * ======================================== */

function syncAriaExpanded() {
    const menus = [
    ];

    const observer = new MutationObserver(function() {
        menus.forEach(({ btn, menu }) => {
            const button = document.getElementById(btn);
            const menuEl = document.getElementById(menu);
            if (button && menuEl) {
                button.setAttribute('aria-expanded', menuEl.classList.contains('show') ? 'true' : 'false');
            }
        });
    });

    menus.forEach(({ menu }) => {
        const menuEl = document.getElementById(menu);
        if (menuEl) {
            observer.observe(menuEl, { attributes: true, attributeFilter: ['class'] });
        }
    });
}

/* ========================================
 * Animations: front-matter toggle
 * If the plan front matter includes
 * `animations: false`, add .no-animations
 * to the body element.
 * ======================================== */

function checkAnimationsFrontMatter() {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const content = editor.value || '';
    const frontMatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!frontMatterMatch) return;

    const fmLines = frontMatterMatch[1].split('\n');
    for (const line of fmLines) {
        const match = line.match(/^\s*animations\s*:\s*(false|off|no|0)\s*$/i);
        if (match) {
            document.body.classList.add('no-animations');
            return;
        }
    }
    document.body.classList.remove('no-animations');
}

/* ========================================
 * Initialise UI embellishments on load
 * ======================================== */

document.addEventListener('DOMContentLoaded', function() {
    initMenuKeyboardNav();
    syncAriaExpanded();
    checkAnimationsFrontMatter();
});
/**
 * Open the RAID form pre-set to a specific type (risk, issue, action, decision, dependency).
 */
function openRaidFormWithType(type) {
    openRaidForm(null);
    const typeField = document.getElementById('raidItemType');
    if (typeField) {
        typeField.value = type;
    }
}

/**
 * Add a new task line to the plan editor and open the task form for editing.
 * Appends a placeholder task line at the end of the editor content.
 */
function addNewTaskViaShortcut() {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const taskLine = '  New Task 1d';
    const text = editor.value;
    const newText = text.endsWith('\n') ? text + taskLine + '\n' : text + '\n' + taskLine + '\n';
    editor.value = newText;
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    // Find the line number of the newly added task and open the task form
    const lines = editor.value.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim() === 'New Task 1d') {
            openTaskForm(i + 1);
            // Focus and select the title so the user can start typing immediately
            setTimeout(() => {
                const titleEl = document.getElementById('taskFormPanelHeader')?.shadowRoot?.querySelector('[contenteditable]');
                if (titleEl) {
                    titleEl.focus();
                    const sel = window.getSelection();
                    const range = document.createRange();
                    range.selectNodeContents(titleEl);
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            }, 150);
            return;
        }
    }
}


/* ======================================================================
 * EARNED VALUE MANAGEMENT (EVM)
 * ====================================================================== */

let evmData = null;  // Cached EVM calculation results
let evmMetricsSheetInstance = null;

/**
 * Calculate EVM metrics from tasks and budget data.
 * This is the core calculation engine that derives all EVM values.
 *
 * PV (Planned Value) = BAC * (planned % of time elapsed)
 * EV (Earned Value) = BAC * actual % complete
 * AC (Actual Cost) = sum of budget items' total (spend to date)
 * BAC (Budget at Completion) = sum of budget items' forecast (total budget)
 */
function calculateEVM(tasks) {
    if (!tasks || tasks.length === 0) return null;

    // Get non-summary, non-milestone tasks with dates
    const workTasks = tasks.filter(t => !t.is_summary && t.duration_days > 0 && t.start && t.finish);
    if (workTasks.length === 0) return null;

    // Calculate overall % complete (weighted by duration)
    let totalDurationDays = 0;
    let weightedComplete = 0;
    workTasks.forEach(t => {
        const dur = t.duration_days || 0;
        const pct = parseFloat(t.percent) || 0;
        totalDurationDays += dur;
        weightedComplete += dur * pct;
    });
    const overallPercentComplete = totalDurationDays > 0 ? weightedComplete / totalDurationDays : 0;

    // Project date range
    const starts = workTasks.map(t => new Date(t.start)).filter(d => !isNaN(d));
    const finishes = workTasks.map(t => new Date(t.finish)).filter(d => !isNaN(d));
    if (starts.length === 0 || finishes.length === 0) return null;

    const projectStart = new Date(Math.min(...starts));
    const projectEnd = new Date(Math.max(...finishes));
    const totalProjectMs = projectEnd - projectStart;
    if (totalProjectMs <= 0) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Time elapsed fraction (clamped 0-1)
    const elapsedMs = Math.max(0, today - projectStart);
    const timeElapsedFraction = Math.min(1, elapsedMs / totalProjectMs);

    // BAC = agreed budget from front matter, or total forecast from budget items
    let BAC = 0;
    let AC = 0;
    if (agreedBudget > 0) {
        BAC = agreedBudget;
        if (typeof budgetItems !== 'undefined' && budgetItems.length > 0) {
            budgetItems.forEach(item => {
                AC += parseFloat(item.total) || 0;
            });
        }
    } else if (typeof budgetItems !== 'undefined' && budgetItems.length > 0) {
        budgetItems.forEach(item => {
            BAC += parseFloat(item.forecast) || parseFloat(item.estimate) || 0;
            AC += parseFloat(item.total) || 0;
        });
    }

    // If no budget data, use task duration as a proxy (1 day = 1 cost unit)
    const hasBudgetData = BAC > 0;
    if (!hasBudgetData) {
        BAC = totalDurationDays;
        // AC estimated from completed work when no actual cost data
        AC = totalDurationDays * (overallPercentComplete / 100);
    }

    // Core EVM calculations
    const PV = BAC * timeElapsedFraction;
    const EV = BAC * (overallPercentComplete / 100);

    // Variances
    const CV = EV - AC;  // Cost Variance
    const SV = EV - PV;  // Schedule Variance

    // Indices (guard against division by zero)
    const CPI = AC !== 0 ? EV / AC : 0;
    const SPI = PV !== 0 ? EV / PV : 0;

    // Forecasts
    const EAC = CPI !== 0 ? BAC / CPI : BAC;  // Estimate at Completion (using CPI method: BAC/CPI)
    const ETC = EAC - AC;  // Estimate to Complete
    const VAC = BAC - EAC; // Variance at Completion
    const TCPI = (BAC - AC) !== 0 ? (BAC - EV) / (BAC - AC) : 0;
    const scheduleForecastDays = SPI > 0 ? totalProjectMs / 86400000 / SPI : totalProjectMs / 86400000;
    const scheduleForecast = new Date(Math.max(today.getTime(), projectStart.getTime() + scheduleForecastDays * 86400000));

    // Build time series data for the chart (monthly periods)
    const timeSeries = buildEvmTimeSeries(workTasks, BAC, projectStart, projectEnd, hasBudgetData, EV, AC);

    return {
        BAC, PV, EV, AC,
        CV, SV,
        CPI, SPI,
        EAC, ETC, VAC, TCPI, scheduleForecast, scheduleForecastDays,
        overallPercentComplete,
        timeElapsedFraction,
        projectStart,
        projectEnd,
        today,
        hasBudgetData,
        timeSeries
    };
}

/**
 * Build time series data points for the EVM chart.
 * Uses version history for real historical EV/AC data points when available,
 * falling back to interpolation when history is insufficient.
 */
function buildEvmTimeSeries(workTasks, BAC, projectStart, projectEnd, hasBudgetData, actualEV, actualAC) {
    const series = { dates: [], pv: [], ev: [], ac: [] };
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const totalProjectMs = projectEnd - projectStart;

    // --- Collect historical data points from version history ---
    var historyPoints = []; // { date: Date, pctComplete: number }
    var projectId = typeof getCurrentProjectId === 'function' ? getCurrentProjectId() : null;
    if (projectId && typeof getVersionHistory === 'function' && typeof extractCompletionFromPlanText === 'function') {
        var history = getVersionHistory(projectId);
        var limit = Math.min(history.length, 50);
        for (var hi = 0; hi < limit; hi++) {
            var pct = extractCompletionFromPlanText(history[hi].planText);
            if (pct !== null && history[hi].date) {
                var d = new Date(history[hi].date);
                d.setHours(0, 0, 0, 0);
                historyPoints.push({ date: d, pctComplete: pct });
            }
        }
        // Sort oldest first
        historyPoints.sort(function(a, b) { return a.date - b.date; });
        // Deduplicate by date (keep latest entry per day)
        var deduped = [];
        for (var di = 0; di < historyPoints.length; di++) {
            var dayKey = historyPoints[di].date.getTime();
            if (deduped.length > 0 && deduped[deduped.length - 1].date.getTime() === dayKey) {
                deduped[deduped.length - 1] = historyPoints[di];
            } else {
                deduped.push(historyPoints[di]);
            }
        }
        historyPoints = deduped;
    }

    // --- Build a map from date (ms) to historical EV ---
    var histMap = {};
    for (var hm = 0; hm < historyPoints.length; hm++) {
        histMap[historyPoints[hm].date.getTime()] = BAC * (historyPoints[hm].pctComplete / 100);
    }

    // Helper: interpolate EV from historical points for a given date
    function interpolateHistoricalEV(pointDate) {
        var pt = pointDate.getTime();
        if (historyPoints.length === 0) return null;
        if (pt <= historyPoints[0].date.getTime()) return BAC * (historyPoints[0].pctComplete / 100);
        if (pt >= historyPoints[historyPoints.length - 1].date.getTime()) {
            return BAC * (historyPoints[historyPoints.length - 1].pctComplete / 100);
        }
        // Find surrounding points
        for (var ip = 1; ip < historyPoints.length; ip++) {
            if (historyPoints[ip].date.getTime() >= pt) {
                var prev = historyPoints[ip - 1];
                var next = historyPoints[ip];
                var frac = (pt - prev.date.getTime()) / (next.date.getTime() - prev.date.getTime());
                var prevEV = BAC * (prev.pctComplete / 100);
                var nextEV = BAC * (next.pctComplete / 100);
                return prevEV + frac * (nextEV - prevEV);
            }
        }
        return null;
    }

    var useHistory = historyPoints.length >= 2;

    // Generate monthly data points from project start to end (or today, whichever is later)
    const chartEnd = new Date(Math.max(projectEnd, today));
    const current = new Date(projectStart);
    current.setDate(1); // Start at beginning of month

    while (current <= chartEnd) {
        const pointDate = new Date(current);
        series.dates.push(pointDate);

        // PV: planned value at this date = BAC * fraction of planned schedule elapsed
        const elapsedMs = Math.max(0, pointDate - projectStart);
        const timeFraction = Math.min(1, elapsedMs / totalProjectMs);
        series.pv.push(BAC * timeFraction);

        // EV and AC: only for dates up to today
        if (pointDate <= today) {
            if (useHistory) {
                // Use real historical data
                var histEV = interpolateHistoricalEV(pointDate);
                if (histEV !== null) {
                    series.ev.push(histEV);
                    // AC: use proportional spend if budget data, otherwise mirror EV
                    if (hasBudgetData) {
                        var evFraction = actualEV > 0 ? histEV / actualEV : 0;
                        series.ac.push(actualAC * Math.min(1, evFraction));
                    } else {
                        series.ac.push(histEV);
                    }
                } else {
                    series.ev.push(0);
                    series.ac.push(0);
                }
            } else {
                // Fallback: interpolate linearly from 0 to actual values
                const todayMs = today - projectStart;
                const pointMs = pointDate - projectStart;
                const progressFraction = todayMs > 0 ? Math.min(1, pointMs / todayMs) : 0;
                series.ev.push(actualEV * progressFraction);
                if (hasBudgetData) {
                    series.ac.push(actualAC * progressFraction);
                } else {
                    series.ac.push(actualEV * progressFraction);
                }
            }
        } else {
            series.ev.push(null);
            series.ac.push(null);
        }

        // Move to next month
        current.setMonth(current.getMonth() + 1);
    }

    // Ensure the last non-null EV and AC data points match the actual values exactly
    let lastNonNullIdx = -1;
    for (let i = series.ev.length - 1; i >= 0; i--) {
        if (series.ev[i] !== null) { lastNonNullIdx = i; break; }
    }
    if (lastNonNullIdx >= 0) {
        series.ev[lastNonNullIdx] = actualEV;
        series.ac[lastNonNullIdx] = actualAC;
    }

    return series;
}

/**
 * Main EVM update function called from updateAllViews.
 */
function updateEVM(tasks) {
    evmData = calculateEVM(tasks);

    const placeholder = document.querySelector('#evm-view .evm-placeholder');
    const content = document.querySelector('#evm-view .evm-content');

    if (!evmData) {
        if (placeholder) placeholder.style.display = '';
        if (content) content.style.display = 'none';
        return;
    }

    if (placeholder) placeholder.style.display = 'none';
    if (content) content.style.display = '';

    renderEvmKpis(evmData);
    renderEvmMetricsTable(evmData);
    renderEvmChart();
}

/**
 * #1114: Forecast view -- reuses the same cached evmData the EVM view
 * renders from (calculateEVM() already ran this cycle in the 'evm'
 * viewUpdates entry, just above this one) rather than recomputing it, so
 * the two views can never disagree. Renders the schedule/cost-at-completion
 * summary, the forecast-focused KPI cards (EAC/ETC/VAC/TCPI/forecast
 * finish), and the same PV/EV/AC-plus-forecast S-curve chart as the EVM
 * view, into the Forecast view's own elements.
 */
function updateForecastView() {
    const placeholder = document.querySelector('#forecast-view .forecast-placeholder');
    const content = document.querySelector('#forecast-view .forecast-content');

    if (!evmData) {
        if (placeholder) placeholder.style.display = '';
        if (content) content.style.display = 'none';
        return;
    }

    if (placeholder) placeholder.style.display = 'none';
    if (content) content.style.display = '';

    renderForecastSummary(evmData);
    renderForecastKpis(evmData);
    renderEvmChart('forecastChart', 'forecastChartLegend');
}

/**
 * Render the "cost at completion" / "schedule at completion" headline
 * summary at the top of the Forecast view -- the two figures the issue
 * (#1114) calls out by name, in plain language rather than acronyms.
 */
function renderForecastSummary(data) {
    const el = document.getElementById('forecastSummary');
    if (!el) return;

    const fmt = (v) => {
        if (data.hasBudgetData) {
            return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        return Number(v).toFixed(1);
    };

    const scheduleDays = Math.round((data.scheduleForecast.getTime() - data.projectEnd.getTime()) / 86400000);
    const scheduleClass = scheduleDays > 0 ? 'evm-kpi-negative' : 'evm-kpi-positive';
    const scheduleText = scheduleDays === 0
        ? 'On the planned finish date'
        : (scheduleDays > 0
            ? Math.abs(scheduleDays) + ' day' + (Math.abs(scheduleDays) === 1 ? '' : 's') + ' later than planned'
            : Math.abs(scheduleDays) + ' day' + (Math.abs(scheduleDays) === 1 ? '' : 's') + ' earlier than planned');

    const costClass = data.VAC >= 0 ? 'evm-kpi-positive' : 'evm-kpi-negative';
    const costText = data.hasBudgetData
        ? (data.VAC >= 0
            ? fmt(Math.abs(data.VAC)) + ' under the ' + fmt(data.BAC) + ' budget'
            : fmt(Math.abs(data.VAC)) + ' over the ' + fmt(data.BAC) + ' budget')
        : 'No budget data -- estimated from task duration';

    el.innerHTML =
        '<div class="forecast-summary-item ' + costClass + '">' +
            '<div class="forecast-summary-label">Cost at completion</div>' +
            '<div class="forecast-summary-value">' + fmt(data.EAC) + '</div>' +
            '<div class="forecast-summary-sub">' + costText + '</div>' +
        '</div>' +
        '<div class="forecast-summary-item ' + scheduleClass + '">' +
            '<div class="forecast-summary-label">Schedule at completion</div>' +
            '<div class="forecast-summary-value">' + data.scheduleForecast.toLocaleDateString() + '</div>' +
            '<div class="forecast-summary-sub">' + scheduleText + '</div>' +
        '</div>';
}

/**
 * Render the Forecast view's KPI cards: the standard EVM forecast measures
 * (EAC, ETC, VAC, TCPI, forecast finish date) called for by #1114, plus
 * CPI/SPI since they're what's driving the forecast.
 */
function renderForecastKpis(data) {
    const grid = document.getElementById('forecastKpiGrid');
    if (!grid) return;

    const fmt = (v) => {
        if (data.hasBudgetData) {
            return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        return Number(v).toFixed(1);
    };
    const fmtIdx = (v) => Number(v).toFixed(2);

    const cpiClass = data.CPI >= 1 ? 'evm-kpi-positive' : 'evm-kpi-negative';
    const spiClass = data.SPI >= 1 ? 'evm-kpi-positive' : 'evm-kpi-negative';
    const vacClass = data.VAC >= 0 ? 'evm-kpi-positive' : 'evm-kpi-negative';
    // TCPI > 1 means more efficiency than achieved so far is now required to
    // land on budget -- the harder ask, so it's flagged the same way CPI < 1 is.
    const tcpiClass = data.TCPI <= 1 ? 'evm-kpi-positive' : 'evm-kpi-negative';

    grid.innerHTML =
        '<div class="evm-kpi-card ' + cpiClass + '">' +
            '<div class="evm-kpi-label">CPI</div>' +
            '<div class="evm-kpi-value">' + fmtIdx(data.CPI) + '</div>' +
        '</div>' +
        '<div class="evm-kpi-card ' + spiClass + '">' +
            '<div class="evm-kpi-label">SPI</div>' +
            '<div class="evm-kpi-value">' + fmtIdx(data.SPI) + '</div>' +
        '</div>' +
        '<div class="evm-kpi-card">' +
            '<div class="evm-kpi-label">Estimate At Completion (EAC)</div>' +
            '<div class="evm-kpi-value">' + fmt(data.EAC) + '</div>' +
        '</div>' +
        '<div class="evm-kpi-card">' +
            '<div class="evm-kpi-label">Estimate To Complete (ETC)</div>' +
            '<div class="evm-kpi-value">' + fmt(data.ETC) + '</div>' +
        '</div>' +
        '<div class="evm-kpi-card ' + vacClass + '">' +
            '<div class="evm-kpi-label">Variance At Completion (VAC)</div>' +
            '<div class="evm-kpi-value">' + fmt(data.VAC) + '</div>' +
        '</div>' +
        '<div class="evm-kpi-card ' + tcpiClass + '">' +
            '<div class="evm-kpi-label">To-Complete Perf. Index (TCPI)</div>' +
            '<div class="evm-kpi-value">' + fmtIdx(data.TCPI) + '</div>' +
        '</div>' +
        '<div class="evm-kpi-card">' +
            '<div class="evm-kpi-label">Forecast Finish</div>' +
            '<div class="evm-kpi-value">' + data.scheduleForecast.toLocaleDateString() + '</div>' +
        '</div>';
}

/**
 * Render EVM KPI cards at the top of the view.
 */
function renderEvmKpis(data) {
    const grid = document.getElementById('evmKpiGrid');
    if (!grid) return;

    const fmt = (v) => {
        if (data.hasBudgetData) {
            return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        return Number(v).toFixed(1);
    };

    const fmtIdx = (v) => Number(v).toFixed(2);
    const fmtPct = (v) => Number(v).toFixed(1) + '%';

    const cvClass = data.CV >= 0 ? 'evm-kpi-positive' : 'evm-kpi-negative';
    const svClass = data.SV >= 0 ? 'evm-kpi-positive' : 'evm-kpi-negative';
    const cpiClass = data.CPI >= 1 ? 'evm-kpi-positive' : 'evm-kpi-negative';
    const spiClass = data.SPI >= 1 ? 'evm-kpi-positive' : 'evm-kpi-negative';

    grid.innerHTML =
        '<div class="evm-kpi-card">' +
            '<div class="evm-kpi-label">% Complete</div>' +
            '<div class="evm-kpi-value">' + fmtPct(data.overallPercentComplete) + '</div>' +
        '</div>' +
        '<div class="evm-kpi-card">' +
            '<div class="evm-kpi-label">BAC (Budget)</div>' +
            '<div class="evm-kpi-value">' + fmt(data.BAC) + '</div>' +
        '</div>' +
        '<div class="evm-kpi-card">' +
            '<div class="evm-kpi-label">Planned Value (PV)</div>' +
            '<div class="evm-kpi-value">' + fmt(data.PV) + '</div>' +
        '</div>' +
        '<div class="evm-kpi-card">' +
            '<div class="evm-kpi-label">Earned Value (EV)</div>' +
            '<div class="evm-kpi-value">' + fmt(data.EV) + '</div>' +
        '</div>' +
        '<div class="evm-kpi-card">' +
            '<div class="evm-kpi-label">Actual Cost (AC)</div>' +
            '<div class="evm-kpi-value">' + fmt(data.AC) + '</div>' +
        '</div>' +
        '<div class="evm-kpi-card ' + cvClass + '">' +
            '<div class="evm-kpi-label">Cost Variance (CV)</div>' +
            '<div class="evm-kpi-value">' + fmt(data.CV) + '</div>' +
        '</div>' +
        '<div class="evm-kpi-card ' + svClass + '">' +
            '<div class="evm-kpi-label">Schedule Variance (SV)</div>' +
            '<div class="evm-kpi-value">' + fmt(data.SV) + '</div>' +
        '</div>' +
        '<div class="evm-kpi-card ' + cpiClass + '">' +
            '<div class="evm-kpi-label">CPI</div>' +
            '<div class="evm-kpi-value">' + fmtIdx(data.CPI) + '</div>' +
        '</div>' +
        '<div class="evm-kpi-card ' + spiClass + '">' +
            '<div class="evm-kpi-label">SPI</div>' +
            '<div class="evm-kpi-value">' + fmtIdx(data.SPI) + '</div>' +
        '</div>';
}

// ── NoodleSheet Integration for EVM Metrics ──────────────────────

const EVM_METRICS_DBML = `Table evm_metrics {
  category text
  metric text
  acronym text
  value text
  interpretation text
}`;

/**
 * Render the detailed EVM metrics table using NoodleSheet.
 */
function renderEvmMetricsTable(data) {
    const container = document.getElementById('evmMetricsSheetContainer');
    if (!container) return;

    const fmt = (v) => {
        if (data.hasBudgetData) {
            return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        return Number(v).toFixed(1);
    };
    const fmtIdx = (v) => Number(v).toFixed(3);

    const metrics = [
        {
            category: 'Measurement',
            name: 'Budget At Completion',
            acronym: 'BAC',
            value: fmt(data.BAC),
            interpretation: 'Total budget for the project'
        },
        {
            category: 'Measurement',
            name: 'Planned Value',
            acronym: 'PV',
            value: fmt(data.PV),
            interpretation: data.PV > data.EV
                ? 'More work was planned than has been earned'
                : 'Planned work is on or ahead of earned value'
        },
        {
            category: 'Measurement',
            name: 'Earned Value',
            acronym: 'EV',
            value: fmt(data.EV),
            interpretation: 'Value of work actually completed (' + data.overallPercentComplete.toFixed(1) + '% of BAC)'
        },
        {
            category: 'Measurement',
            name: 'Actual Cost',
            acronym: 'AC',
            value: fmt(data.AC),
            interpretation: data.hasBudgetData ? 'Amount spent to date from budget items' : 'Estimated from completed work (no budget data)'
        },
        {
            category: 'Variance',
            name: 'Cost Variance',
            acronym: 'CV',
            value: fmt(data.CV),
            interpretation: data.CV >= 0
                ? 'Under budget by ' + fmt(Math.abs(data.CV))
                : 'Over budget by ' + fmt(Math.abs(data.CV))
        },
        {
            category: 'Variance',
            name: 'Schedule Variance',
            acronym: 'SV',
            value: fmt(data.SV),
            interpretation: data.SV >= 0
                ? 'Ahead of schedule'
                : 'Behind schedule'
        },
        {
            category: 'Variance',
            name: 'Variance At Completion',
            acronym: 'VAC',
            value: fmt(data.VAC),
            interpretation: data.VAC >= 0
                ? 'Expected to finish ' + fmt(Math.abs(data.VAC)) + ' under budget'
                : 'Expected to finish ' + fmt(Math.abs(data.VAC)) + ' over budget'
        },
        {
            category: 'Index',
            name: 'Cost Performance Index',
            acronym: 'CPI',
            value: fmtIdx(data.CPI),
            interpretation: data.CPI >= 1
                ? 'Getting ' + fmtIdx(data.CPI) + ' worth of value for every 1 spent'
                : 'Getting only ' + fmtIdx(data.CPI) + ' worth of value for every 1 spent'
        },
        {
            category: 'Index',
            name: 'Schedule Performance Index',
            acronym: 'SPI',
            value: fmtIdx(data.SPI),
            interpretation: data.SPI >= 1
                ? 'Progressing at ' + (data.SPI * 100).toFixed(0) + '% of planned rate'
                : 'Progressing at only ' + (data.SPI * 100).toFixed(0) + '% of planned rate'
        },
        {
            category: 'Forecast',
            name: 'Estimate At Completion',
            acronym: 'EAC',
            value: fmt(data.EAC),
            interpretation: 'Projected total cost based on current CPI'
        },
        {
            category: 'Forecast',
            name: 'Estimate To Complete',
            acronym: 'ETC',
            value: fmt(data.ETC),
            interpretation: 'Remaining cost to finish the project'
        },
        {
            category: 'Forecast',
            name: 'To Complete Performance Index',
            acronym: 'TCPI',
            value: fmtIdx(data.TCPI),
            interpretation: 'Efficiency required to meet the approved budget'
        },
        {
            category: 'Forecast',
            name: 'Schedule Forecast',
            acronym: 'Finish',
            value: data.scheduleForecast.toLocaleDateString(),
            interpretation: 'Forecast finish using the current schedule performance index'
        }
    ];

    // Build markdown table for NoodleSheet
    const escPipe = (text) => String(text || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const headers = ['Category', 'Metric', 'Acronym', 'Value', 'Interpretation'];
    const rows = metrics.map(m => [
        escPipe(m.category),
        escPipe(m.name),
        escPipe(m.acronym),
        escPipe(m.value),
        escPipe(m.interpretation)
    ]);

    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
    const pad = (str, width) => str + ' '.repeat(Math.max(0, width - str.length));
    const formatRow = (cells) => '| ' + cells.map((c, i) => pad(c, widths[i])).join(' | ') + ' |';
    const separator = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';

    let md = formatRow(headers) + '\n' + separator + '\n';
    rows.forEach(row => { md += formatRow(row) + '\n'; });

    if (evmMetricsSheetInstance) {
        // Update existing sheet with new data
        evmMetricsSheetInstance.loadMarkdown(md, 0);
    } else {
        // Create new read-only NoodleSheet instance
        evmMetricsSheetInstance = new NoodleSheet(container, {
            sheets: [{
                name: 'EVM Metrics',
                dbml: EVM_METRICS_DBML,
                markdown: md
            }],
            readOnly: true,
            showTotals: false
        });
    }
}

/**
 * Render the EVM S-curve chart using SVG.
 *
 * #1114: takes the target svg/legend element ids so the Forecast view can
 * render the same PV/EV/AC-plus-forecast chart into its own `#forecastChart`
 * / `#forecastChartLegend` pair without duplicating this function -- it's
 * the same evmData, just displayed in a second place.
 */
function renderEvmChart(svgId, legendId) {
    if (!evmData || !evmData.timeSeries) return;

    const svg = document.getElementById(svgId || 'evmChart');
    const legend = document.getElementById(legendId || 'evmChartLegend');
    if (!svg) return;

    const container = svg.parentElement;
    const width = container.clientWidth || 700;
    const height = 350;
    const padding = { top: 30, right: 30, bottom: 60, left: 70 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);

    // Read CSS custom properties for theme-aware colours
    const cs = getComputedStyle(document.documentElement);
    const cvar = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    const colChartBg   = cvar('--evm-chart-bg', '#f8f9fa');
    const colGridLine  = cvar('--evm-grid-line', '#e0e0e0');
    const colAxisLine  = cvar('--evm-axis-line', '#999');
    const colAxisLabel = cvar('--evm-axis-label', '#666');
    const colTextMuted = cvar('--evm-text-muted', '#888');
    const colLinePV    = cvar('--evm-line-pv', '#2171b5');
    const colLineEV    = cvar('--evm-line-ev', '#2ca02c');
    const colLineAC    = cvar('--evm-line-ac', '#d62728');
    const colLineToday = cvar('--evm-line-today', '#e6a817');
    const colBacLine   = cvar('--evm-bac-line', '#999');

    const ts = evmData.timeSeries;
    if (!ts.dates || ts.dates.length === 0) {
        svg.innerHTML = '<text x="' + (width / 2) + '" y="' + (height / 2) + '" text-anchor="middle" fill="' + colTextMuted + '" font-size="14">Insufficient data for chart</text>';
        return;
    }

    // Find max value for Y axis
    const allValues = [...ts.pv, ...ts.ev.filter(v => v !== null), ...ts.ac.filter(v => v !== null)];
    const maxVal = Math.max(...allValues, 1);
    const yMax = Math.ceil(maxVal * 1.1); // 10% headroom

    // X scale: map date index to x position
    const xScale = (i) => padding.left + (i / (ts.dates.length - 1)) * chartW;
    // Y scale: map value to y position (inverted)
    const yScale = (v) => padding.top + chartH - (v / yMax) * chartH;

    let svgContent = '';

    // Background
    svgContent += '<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="' + colChartBg + '" rx="4"/>';

    // Grid lines
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
        const y = padding.top + (i / gridLines) * chartH;
        const val = yMax * (1 - i / gridLines);
        svgContent += '<line x1="' + padding.left + '" y1="' + y + '" x2="' + (width - padding.right) + '" y2="' + y + '" stroke="' + colGridLine + '" stroke-width="1" stroke-dasharray="4,4"/>';
        svgContent += '<text x="' + (padding.left - 8) + '" y="' + (y + 4) + '" text-anchor="end" fill="' + colAxisLabel + '" font-size="11">' + formatEvmAxisValue(val, evmData.hasBudgetData) + '</text>';
    }

    // X axis labels (dates)
    const labelStep = Math.max(1, Math.floor(ts.dates.length / 8));
    for (let i = 0; i < ts.dates.length; i += labelStep) {
        const x = xScale(i);
        const d = ts.dates[i];
        const label = d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
        svgContent += '<text x="' + x + '" y="' + (height - padding.bottom + 20) + '" text-anchor="middle" fill="' + colAxisLabel + '" font-size="11">' + label + '</text>';
        svgContent += '<line x1="' + x + '" y1="' + padding.top + '" x2="' + x + '" y2="' + (padding.top + chartH) + '" stroke="' + colGridLine + '" stroke-width="1" stroke-dasharray="2,4"/>';
    }

    // Axis lines
    svgContent += '<line x1="' + padding.left + '" y1="' + padding.top + '" x2="' + padding.left + '" y2="' + (padding.top + chartH) + '" stroke="' + colAxisLine + '" stroke-width="1"/>';
    svgContent += '<line x1="' + padding.left + '" y1="' + (padding.top + chartH) + '" x2="' + (width - padding.right) + '" y2="' + (padding.top + chartH) + '" stroke="' + colAxisLine + '" stroke-width="1"/>';

    // Helper to build a polyline path
    function buildPath(values, skipNull) {
        let points = [];
        for (let i = 0; i < values.length; i++) {
            if (skipNull && values[i] === null) continue;
            points.push(xScale(i) + ',' + yScale(values[i]));
        }
        return points.join(' ');
    }

    // PV line (planned value) - dashed blue
    svgContent += '<polyline points="' + buildPath(ts.pv, false) + '" fill="none" stroke="' + colLinePV + '" stroke-width="2.5" stroke-dasharray="6,3"/>';

    // EV line (earned value) - solid green
    const evFiltered = ts.ev.filter(v => v !== null);
    if (evFiltered.length > 0) {
        svgContent += '<polyline points="' + buildPath(ts.ev, true) + '" fill="none" stroke="' + colLineEV + '" stroke-width="2.5"/>';
    }

    // AC line (actual cost) - solid red/orange
    const acFiltered = ts.ac.filter(v => v !== null);
    if (acFiltered.length > 0) {
        svgContent += '<polyline points="' + buildPath(ts.ac, true) + '" fill="none" stroke="' + colLineAC + '" stroke-width="2.5"/>';
    }

    // Today line - interpolate to exact date position
    let todayX = null;
    const todayTime = evmData.today.getTime();
    if (todayTime <= ts.dates[0].getTime()) {
        todayX = xScale(0);
    } else if (todayTime >= ts.dates[ts.dates.length - 1].getTime()) {
        todayX = xScale(ts.dates.length - 1);
    } else {
        for (let ti = 1; ti < ts.dates.length; ti++) {
            if (ts.dates[ti].getTime() >= todayTime) {
                const prevTime = ts.dates[ti - 1].getTime();
                const nextTime = ts.dates[ti].getTime();
                const frac = (todayTime - prevTime) / (nextTime - prevTime);
                todayX = xScale(ti - 1) + frac * (xScale(ti) - xScale(ti - 1));
                break;
            }
        }
    }
    if (todayX !== null) {
        svgContent += '<line x1="' + todayX + '" y1="' + padding.top + '" x2="' + todayX + '" y2="' + (padding.top + chartH) + '" stroke="' + colLineToday + '" stroke-width="1.5" stroke-dasharray="4,2"/>';
        svgContent += '<text x="' + todayX + '" y="' + (padding.top - 8) + '" text-anchor="middle" fill="' + colLineToday + '" font-size="10">Today</text>';
    }

    // Forecast continuation: keep the measured curves solid and make the
    // schedule/cost projections visibly distinct after today's point.
    if (todayX !== null && ts.dates.length > 1) {
        const todayIndex = ts.dates.reduce((best, date, index) =>
            Math.abs(date - evmData.today) < Math.abs(ts.dates[best] - evmData.today) ? index : best, 0);
        const endIndex = ts.dates.length - 1;
        const forecastFinish = Math.min(evmData.scheduleForecast.getTime(), ts.dates[endIndex].getTime());
        const finishIndex = ts.dates.reduce((best, date, index) =>
            Math.abs(date - forecastFinish) < Math.abs(ts.dates[best] - forecastFinish) ? index : best, 0);
        const startEv = ts.ev[todayIndex] == null ? evmData.EV : ts.ev[todayIndex];
        const startAc = ts.ac[todayIndex] == null ? evmData.AC : ts.ac[todayIndex];
        const forecastX = xScale(Math.max(todayIndex, finishIndex));
        svgContent += '<line x1="' + xScale(todayIndex) + '" y1="' + yScale(startEv) + '" x2="' + forecastX + '" y2="' + yScale(evmData.BAC) + '" stroke="' + colLineEV + '" stroke-width="2.5" stroke-dasharray="5,4"/>';
        svgContent += '<line x1="' + xScale(todayIndex) + '" y1="' + yScale(startAc) + '" x2="' + xScale(endIndex) + '" y2="' + yScale(evmData.EAC) + '" stroke="' + colLineAC + '" stroke-width="2.5" stroke-dasharray="5,4"/>';
    }

    // BAC reference line
    const bacY = yScale(evmData.BAC);
    if (bacY >= padding.top && bacY <= padding.top + chartH) {
        svgContent += '<line x1="' + padding.left + '" y1="' + bacY + '" x2="' + (width - padding.right) + '" y2="' + bacY + '" stroke="' + colBacLine + '" stroke-width="1" stroke-dasharray="8,4"/>';
        svgContent += '<text x="' + (width - padding.right + 4) + '" y="' + (bacY + 4) + '" fill="' + colBacLine + '" font-size="10" text-anchor="start">BAC</text>';
    }

    // Data point dots
    for (let i = 0; i < ts.dates.length; i++) {
        if (ts.pv[i] !== null && ts.pv[i] !== undefined) {
            svgContent += '<circle cx="' + xScale(i) + '" cy="' + yScale(ts.pv[i]) + '" r="3" fill="' + colLinePV + '"/>';
        }
        if (ts.ev[i] !== null && ts.ev[i] !== undefined) {
            svgContent += '<circle cx="' + xScale(i) + '" cy="' + yScale(ts.ev[i]) + '" r="3" fill="' + colLineEV + '"/>';
        }
        if (ts.ac[i] !== null && ts.ac[i] !== undefined) {
            svgContent += '<circle cx="' + xScale(i) + '" cy="' + yScale(ts.ac[i]) + '" r="3" fill="' + colLineAC + '"/>';
        }
    }

    // Axis labels
    svgContent += '<text x="' + (width / 2) + '" y="' + (height - 5) + '" text-anchor="middle" fill="' + colTextMuted + '" font-size="12">Time</text>';
    svgContent += '<text x="15" y="' + (height / 2) + '" text-anchor="middle" fill="' + colTextMuted + '" font-size="12" transform="rotate(-90 15 ' + (height / 2) + ')">Value' + (evmData.hasBudgetData ? ' (Currency)' : ' (Days)') + '</text>';

    svg.innerHTML = svgContent;

    // Legend
    if (legend) {
        legend.innerHTML =
            '<span class="evm-legend-item"><span class="evm-legend-swatch" style="background:' + colLinePV + '; border-style:dashed;"></span> Planned Value (PV)</span>' +
            '<span class="evm-legend-item"><span class="evm-legend-swatch" style="background:' + colLineEV + ';"></span> Earned Value (EV)</span>' +
            '<span class="evm-legend-item"><span class="evm-legend-swatch" style="background:' + colLineAC + ';"></span> Actual Cost (AC)</span>' +
            '<span class="evm-legend-item"><span class="evm-legend-swatch evm-legend-swatch-dashed" style="background:' + colLineEV + ';"></span> Forecast</span>' +
            '<span class="evm-legend-item"><span class="evm-legend-swatch" style="background:' + colLineToday + '; border-style:dashed;"></span> Today</span>';
    }
}

/**
 * Format axis values for the EVM chart.
 */
function formatEvmAxisValue(val, isCurrency) {
    if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
    if (val >= 1000) return (val / 1000).toFixed(1) + 'K';
    if (isCurrency) return val.toFixed(0);
    return val.toFixed(1);
}
