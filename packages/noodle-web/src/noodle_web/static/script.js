let selectedFile = null;
let renderTimeout = null;
let globalResourceMap = {}; // Maps shortnames to full names from backend
let globalResourceDetails = {}; // Maps shortnames to { name, role } from front matter

// Track which section the resource form was opened from (for returning to it)
let resourceFormReturnSection = null;

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
 * Open the detail pane and show the specified section.
 * Hides all other sections within the pane.
 */
function openDetailPane(sectionId) {
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

    // Hide all sections after transition
    setTimeout(() => {
        pane.querySelectorAll('.detail-pane-section').forEach(s => s.classList.remove('active'));
    }, 300);
}

/**
 * Check if the detail pane is currently open.
 */
function isDetailPaneOpen() {
    const pane = document.getElementById('detailPane');
    return pane && pane.classList.contains('open');
}

function switchTab(tabName) {
    // Remove active class from all tabs and content
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    // Find and activate the correct tab button
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        const onclick = tab.getAttribute('onclick');
        if (onclick && onclick.includes(`'${tabName}'`)) {
            tab.classList.add('active');
        }
    });

    // Activate the corresponding content
    const tabContent = document.getElementById(tabName + '-tab');
    if (tabContent) {
        tabContent.classList.add('active');
    }

    // Show/hide RAID-specific export menu items based on active tab
    const raidExportItems = document.querySelectorAll('.raid-export-item');
    raidExportItems.forEach(item => {
        item.style.display = tabName === 'raid' ? '' : 'none';
    });

    // If switching to RAID tab, load items from plan text if empty
    if (tabName === 'raid' && raidItems.length === 0) {
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

    // If switching to Gantt tab, re-render the chart
    if (tabName === 'gantt') {
        setTimeout(() => {
            if (ganttTasks && ganttTasks.length > 0) {
                renderGanttChart();
            } else if (window.parsedPlanData && window.parsedPlanData.tasks) {
                updateGantt(window.parsedPlanData.tasks);
            }
        }, 50);
    }
}

// Initialize editor functionality when DOM is ready
window.addEventListener('load', function() {
    initializeEditor();
    initializeKanbanEditor();
    initializeUploadTab();
    initializeEditorDragDrop();
});

function initializeEditor() {
    const editor = document.getElementById('planEditor');
    const lineNumbers = document.getElementById('lineNumbers');
    const highlightLayer = document.getElementById('highlightLayer');

    if (!editor || !lineNumbers) {
        console.error('Editor or line numbers not found');
        return;
    }

    setupEditor(editor, lineNumbers, highlightLayer, true);
}

function initializeKanbanEditor() {
    const editor = document.getElementById('kanbanPlanEditor');
    const lineNumbers = document.getElementById('kanbanLineNumbers');
    const highlightLayer = document.getElementById('kanbanHighlightLayer');

    if (!editor || !lineNumbers) {
        console.error('Kanban editor or line numbers not found');
        return;
    }

    setupEditor(editor, lineNumbers, highlightLayer, false);
}

function setupEditor(editor, lineNumbers, highlightLayer, shouldRender) {

    // Syntax highlighting function
    function highlightSyntax(text) {
        // Build a set of all task names for dependency validation
        const allTaskNames = new Set();
        const allLines = text.split('\n');
        let inFrontMatter = false;
        let inHighlights = false;
        let inRaidLog = false;
        for (let i = 0; i < allLines.length; i++) {
            const trimmed = allLines[i].trim();
            if (trimmed === '---') {
                inFrontMatter = !inFrontMatter;
                continue;
            }
            if (trimmed === '---highlights---') { inHighlights = true; continue; }
            if (trimmed === '---end-highlights---' || (inHighlights && trimmed === '---raid log---')) { inHighlights = false; }
            if (trimmed === '---raid log---') { inRaidLog = true; continue; }
            if (inFrontMatter || inHighlights || inRaidLog || !trimmed || trimmed.startsWith('#') || trimmed.includes('===')) continue;

            // Extract task name using lightweight parsing (avoids recursive parseTaskLine calls)
            let taskText = trimmed;
            // Strip * prefix
            if (taskText.startsWith('*')) {
                taskText = taskText.substring(1).trim();
                // Strip optional lag/lead after *
                taskText = taskText.replace(/^[+\-]\d+[dwmy]\s+/, '');
            }
            // Remove comments in quotes
            taskText = taskText.replace(/"[^"]*"/, '').trim();
            // Remove [depends ...] blocks
            taskText = taskText.replace(/\[depends\s+[^\]]+\]/gi, '').trim();
            // Remove bucket names in curly braces
            taskText = taskText.replace(/\{[^}]+\}/g, '').trim();
            // Remove priority markers
            taskText = taskText.replace(/(?<!\w)(!!!|!!|!)(?!["'{])/g, '').trim();
            // Extract name tokens (everything that's not a duration, resource, date, percent, or label)
            const tokens = taskText.split(/\s+/);
            const nameTokens = [];
            for (const token of tokens) {
                if (!token) continue;
                if (token.startsWith('@')) continue;       // resource
                if (token.startsWith('#')) continue;       // label
                if (/^\d+[dmw]$/.test(token)) continue;   // duration
                if (/^\d+%$/.test(token)) continue;        // percent
                if (/^\d{4}-\d{2}-\d{2}$/.test(token)) continue; // date
                nameTokens.push(token);
            }
            const name = nameTokens.join(' ');
            if (name) allTaskNames.add(name);
        }

        let inHighlightsSection = false;
        let inRaidLogSection = false;
        return allLines.map(line => {
            // Track highlights section boundaries
            if (line.trim() === '---highlights---') {
                inHighlightsSection = true;
                return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            if (line.trim() === '---end-highlights---' || (inHighlightsSection && line.trim() === '---raid log---')) {
                inHighlightsSection = false;
                // If it was the raid log marker, also enter raid log section
                if (line.trim() === '---raid log---') {
                    inRaidLogSection = true;
                    return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
                }
                return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            // Dim lines inside highlights section
            if (inHighlightsSection) {
                return '<span class="syntax-highlights-content">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            // Track RAID log section
            if (line.trim() === '---raid log---') {
                inRaidLogSection = true;
                return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            // Dim lines inside RAID log section
            if (inRaidLogSection) {
                return '<span class="syntax-highlights-content">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }

            // Skip empty lines and headers
            if (!line.trim() || line.includes('===') || line.includes('---')) {
                return line;
            }

            // Escape HTML first to prevent issues
            let highlighted = line.replace(/</g, '&lt;').replace(/>/g, '&gt;');

            // Use placeholder strategy to avoid regex conflicts
            const placeholders = [];
            let placeholderIndex = 0;

            function savePlaceholder(replacement) {
                const placeholder = `__PLACEHOLDER_${placeholderIndex}__`;
                placeholders.push({ placeholder, replacement });
                placeholderIndex++;
                return placeholder;
            }

            // Highlight comments (text in quotes) - do first to protect from other replacements
            highlighted = highlighted.replace(/"([^"]*)"/g, (match, content) => {
                return savePlaceholder('<span class="syntax-comment">"' + content + '"</span>');
            });

            // Highlight dependencies EARLY to protect lag/lead from duration highlighter
            // (e.g., [depends Task1, Task2 +2d])
            highlighted = highlighted.replace(/\[depends\s+([^\]]+)\]/gi, (match, deps) => {
                // Split dependencies and validate each one
                const depParts = deps.split(',').map(d => d.trim()).filter(d => d);
                const highlightedParts = depParts.map(dep => {
                    // Strip lag/lead to get the task name for validation
                    const lagLeadMatch = dep.match(/^(.+?)\s+([+\-]\d+[dwmy])$/);
                    const depTaskName = lagLeadMatch ? lagLeadMatch[1].trim() : dep.trim();
                    const lagLeadPart = lagLeadMatch ? ' <span class="syntax-lag-lead">' + lagLeadMatch[2] + '</span>' : '';

                    // Check if the dependency task name exists
                    const isValid = allTaskNames.has(depTaskName);
                    if (isValid) {
                        return depTaskName + lagLeadPart;
                    } else {
                        return '<span class="syntax-error">' + depTaskName + '</span>' + lagLeadPart;
                    }
                });
                return savePlaceholder('<span class="syntax-dependency">[depends ' + highlightedParts.join(', ') + ']</span>');
            });

            // Highlight star prefix (depends on previous task) - match * at line start
            highlighted = highlighted.replace(/^(\s*)(\*)/, (match, space, star) => {
                return space + savePlaceholder('<span class="syntax-star">' + star + '</span>');
            });

            // Highlight durations (e.g., 3d, 5w, 2m)
            highlighted = highlighted.replace(/\b(\d+[dmw])\b/g, (match, duration) => {
                return savePlaceholder('<span class="syntax-duration">' + duration + '</span>');
            });

            // Highlight resources (e.g., @alice, @bob)
            highlighted = highlighted.replace(/@(\w+)/g, (match, name) => {
                return savePlaceholder('<span class="syntax-resource">@' + name + '</span>');
            });

            // Highlight percentages (e.g., 50%, 75%)
            highlighted = highlighted.replace(/\b(\d+%)/g, (match, percent) => {
                return savePlaceholder('<span class="syntax-percent">' + percent + '</span>');
            });

            // Highlight ISO dates (e.g., 2025-11-10)
            highlighted = highlighted.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (match, date) => {
                return savePlaceholder('<span class="syntax-date">' + date + '</span>');
            });

            // Highlight labels/tags (e.g., #DEV, #HIGH)
            highlighted = highlighted.replace(/#(\w+)/g, (match, name) => {
                return savePlaceholder('<span class="syntax-label">#' + name + '</span>');
            });

            // Highlight bucket names (e.g., {Project Management})
            highlighted = highlighted.replace(/\{([^}]+)\}/g, (match, bucket) => {
                return savePlaceholder('<span class="syntax-bucket">{' + bucket + '}</span>');
            });

            // Highlight priority markers (!!!, !!, !)
            highlighted = highlighted.replace(/(?<!\w)(!!!|!!|!)(?!["'{])/g, (match, marker) => {
                return savePlaceholder('<span class="syntax-priority">' + marker + '</span>');
            });

            // Replace all placeholders with actual HTML
            placeholders.forEach(({ placeholder, replacement }) => {
                highlighted = highlighted.replace(placeholder, replacement);
            });

            return highlighted;
        }).join('\n');
    }

    // Update line numbers and syntax highlighting
    function updateLineNumbers() {
        const content = editor.value || editor.placeholder || '';
        const lines = content.split('\n');
        const lineCount = lines.length;

        // Create line number elements instead of plain text
        lineNumbers.innerHTML = '';
        for (let i = 1; i <= lineCount; i++) {
            const lineNumSpan = document.createElement('div');
            lineNumSpan.className = 'line-number';

            // Check if this line has a manually scheduled task (has explicit start date)
            const line = lines[i - 1]; // 0-indexed
            const isManuallyScheduled = isLineManuallyScheduled(line);

            if (isManuallyScheduled) {
                lineNumSpan.classList.add('manually-scheduled');
                lineNumSpan.title = 'Manually scheduled (has explicit start date)';

                // Add pin icon before line number
                const pinIcon = document.createElement('span');
                pinIcon.className = 'pin-icon';
                lineNumSpan.appendChild(pinIcon);
            }

            const lineNumText = document.createElement('span');
            lineNumText.textContent = i;
            lineNumSpan.appendChild(lineNumText);

            lineNumSpan.dataset.lineNumber = i;
            lineNumbers.appendChild(lineNumSpan);
        }

        // Update syntax highlighting
        if (highlightLayer) {
            const highlighted = highlightSyntax(content);
            highlightLayer.innerHTML = highlighted;
        }

        // Re-sync scroll positions after innerHTML replacement resets them
        syncScroll();

        // Update active line indicator
        updateActiveLine();
    }

    // Helper function to detect if a task line is manually scheduled (has explicit start date)
    function isLineManuallyScheduled(line) {
        if (!line || !line.trim()) return false;

        // Skip front matter
        if (line.trim() === '---') return false;

        // Skip comments and empty lines
        if (line.trim().startsWith('#') || !line.trim()) return false;

        // Check if line contains a date in YYYY-MM-DD format
        // This indicates an explicit start date, making it manually scheduled
        const datePattern = /\d{4}-\d{2}-\d{2}/;
        return datePattern.test(line);
    }

    // Update the active line indicator
    function updateActiveLine() {
        const cursorPosition = editor.selectionStart;
        const textBeforeCursor = editor.value.substring(0, cursorPosition);
        const currentLine = textBeforeCursor.split('\n').length;

        // Remove active class from all line numbers
        const allLineNumbers = lineNumbers.querySelectorAll('.line-number');
        allLineNumbers.forEach(ln => ln.classList.remove('active'));

        // Add active class to current line
        const activeLineElement = lineNumbers.querySelector(`[data-line-number="${currentLine}"]`);
        if (activeLineElement) {
            activeLineElement.classList.add('active');
        }
    }

    // Sync scroll
    function syncScroll() {
        lineNumbers.scrollTop = editor.scrollTop;
        if (highlightLayer) {
            highlightLayer.scrollTop = editor.scrollTop;
            highlightLayer.scrollLeft = editor.scrollLeft;
        }
    }

    // Initialize
    updateLineNumbers();

    // Debounce timer for render requests
    let renderDebounceTimer = null;

    // Update on input and auto-render with debounce (only for main editor)
    editor.addEventListener('input', function() {
        updateLineNumbers();

        // Only trigger auto-render for the main editor
        if (shouldRender) {
            // Clear previous timer if it exists
            if (renderDebounceTimer) {
                clearTimeout(renderDebounceTimer);
            }

            // Auto-render after 1 second of inactivity
            renderDebounceTimer = setTimeout(() => {
                renderText();
                renderDebounceTimer = null;
            }, 1000);
        }
    });

    // Sync scroll
    editor.addEventListener('scroll', syncScroll);

    // Track cursor position for active line indicator
    editor.addEventListener('click', updateActiveLine);
    editor.addEventListener('keyup', updateActiveLine);
    editor.addEventListener('focus', updateActiveLine);

    // Keyboard shortcuts
    editor.addEventListener('keydown', function(e) {

        // Indent with Cmd+] (macOS) or Ctrl+] (Windows/Linux)
        if ((e.metaKey || e.ctrlKey) && e.key === ']') {
            e.preventDefault();
            indentSelectedLines();
        }

        // Outdent with Cmd+[ (macOS) or Ctrl+[ (Windows/Linux)
        if ((e.metaKey || e.ctrlKey) && e.key === '[') {
            e.preventDefault();
            outdentSelectedLines();
        }
    });

    // Long-press on line numbers to open task form (mobile support)
    let longPressTimer = null;
    let longPressLineNumber = null;

    lineNumbers.addEventListener('touchstart', function(e) {
        const target = e.target.closest('.line-number');
        if (!target) return;

        longPressLineNumber = parseInt(target.dataset.lineNumber);
        longPressTimer = setTimeout(() => {
            if (typeof openTaskForm === 'function') {
                openTaskForm(longPressLineNumber);
            }
        }, 500); // 500ms long press
    });

    lineNumbers.addEventListener('touchend', function(e) {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });

    lineNumbers.addEventListener('touchmove', function(e) {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });
}

/**
 * Indent selected lines in the editor by 2 spaces
 */
function indentSelectedLines() {
    // Get the currently focused editor (main or kanban)
    const mainEditor = document.getElementById('planEditor');
    const kanbanEditor = document.getElementById('kanbanPlanEditor');
    const editor = (kanbanEditor && document.activeElement === kanbanEditor) ? kanbanEditor : mainEditor;
    if (!editor) return;

    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const text = editor.value;

    // Find the start of the first selected line
    let lineStart = start;
    while (lineStart > 0 && text[lineStart - 1] !== '\n') {
        lineStart--;
    }

    // Find the end of the last selected line
    let lineEnd = end;
    while (lineEnd < text.length && text[lineEnd] !== '\n') {
        lineEnd++;
    }

    // Extract the selected lines
    const selectedText = text.substring(lineStart, lineEnd);
    const lines = selectedText.split('\n');

    // Indent each line by 2 spaces
    const indentedLines = lines.map(line => '  ' + line);
    const indentedText = indentedLines.join('\n');

    // Replace the selected text with indented version
    editor.value = text.substring(0, lineStart) + indentedText + text.substring(lineEnd);

    // Restore selection, adjusting for added spaces
    const newStart = start + 2; // First line gets 2 spaces
    const newEnd = end + (indentedLines.length * 2); // Each line gets 2 spaces
    editor.setSelectionRange(newStart, newEnd);

    // Trigger render
    editor.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Outdent selected lines in the editor by up to 2 spaces
 */
function outdentSelectedLines() {
    // Get the currently focused editor (main or kanban)
    const mainEditor = document.getElementById('planEditor');
    const kanbanEditor = document.getElementById('kanbanPlanEditor');
    const editor = (kanbanEditor && document.activeElement === kanbanEditor) ? kanbanEditor : mainEditor;
    if (!editor) return;

    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const text = editor.value;

    // Find the start of the first selected line
    let lineStart = start;
    while (lineStart > 0 && text[lineStart - 1] !== '\n') {
        lineStart--;
    }

    // Find the end of the last selected line
    let lineEnd = end;
    while (lineEnd < text.length && text[lineEnd] !== '\n') {
        lineEnd++;
    }

    // Extract the selected lines
    const selectedText = text.substring(lineStart, lineEnd);
    const lines = selectedText.split('\n');

    // Outdent each line by up to 2 spaces
    const outdentedLines = lines.map(line => {
        // Remove up to 2 leading spaces
        if (line.startsWith('  ')) {
            return line.substring(2);
        } else if (line.startsWith(' ')) {
            return line.substring(1);
        }
        return line;
    });
    const outdentedText = outdentedLines.join('\n');

    // Calculate how many characters were removed
    const removedChars = selectedText.length - outdentedText.length;

    // Replace the selected text with outdented version
    editor.value = text.substring(0, lineStart) + outdentedText + text.substring(lineEnd);

    // Restore selection, adjusting for removed spaces
    const charsRemovedBeforeStart = Math.min(2, selectedText.substring(0, start - lineStart).match(/^ */)[0].length);
    const newStart = Math.max(lineStart, start - charsRemovedBeforeStart);
    const newEnd = Math.max(newStart, end - removedChars);
    editor.setSelectionRange(newStart, newEnd);

    // Trigger render
    editor.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Extract the task name from a single editor line.
 * Returns empty string if the line is not a task (blank, header, separator, etc.)
 */
function extractTaskNameFromEditorLine(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.includes('===') || trimmed.includes('---')) {
        return '';
    }
    const task = parseTaskLine(line, 0);
    return task.name ? task.name.trim() : '';
}

/**
 * Add or replace a [depends TaskName] tag on a line.
 * If the line already has a [depends ...] block, the new dependency is appended.
 */
function addDependencyToLine(line, dependencyName) {
    const dependsPattern = /\[depends\s+([^\]]+)\]/i;
    const existingMatch = line.match(dependsPattern);

    if (existingMatch) {
        const existingDeps = existingMatch[1].split(',').map(d => d.trim());
        if (!existingDeps.some(d => d === dependencyName || d.startsWith(dependencyName + ' '))) {
            const updatedDeps = existingDeps.concat(dependencyName).join(', ');
            return line.replace(dependsPattern, '[depends ' + updatedDeps + ']');
        }
        return line; // Already has this dependency
    }

    return line.trimEnd() + ' [depends ' + dependencyName + ']';
}

/**
 * Link selected tasks as a dependency chain from top to bottom.
 * Each task becomes dependent on the task above it in the selection.
 */
function linkSelectedTasks() {
    const mainEditor = document.getElementById('planEditor');
    const kanbanEditor = document.getElementById('kanbanPlanEditor');
    const editor = (kanbanEditor && document.activeElement === kanbanEditor) ? kanbanEditor : mainEditor;
    if (!editor) return;

    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const text = editor.value;

    // Find the start of the first selected line
    let lineStart = start;
    while (lineStart > 0 && text[lineStart - 1] !== '\n') {
        lineStart--;
    }

    // Find the end of the last selected line
    let lineEnd = end;
    while (lineEnd < text.length && text[lineEnd] !== '\n') {
        lineEnd++;
    }

    const selectedText = text.substring(lineStart, lineEnd);
    const lines = selectedText.split('\n');

    // Extract task names and filter to valid task lines
    const taskEntries = [];
    for (let i = 0; i < lines.length; i++) {
        const name = extractTaskNameFromEditorLine(lines[i]);
        if (name) {
            taskEntries.push({ index: i, name: name });
        }
    }

    // Need at least 2 tasks to create a chain
    if (taskEntries.length < 2) return;

    // Chain each task to depend on the previous one
    for (let i = 1; i < taskEntries.length; i++) {
        const prevTaskName = taskEntries[i - 1].name;
        const lineIndex = taskEntries[i].index;
        lines[lineIndex] = addDependencyToLine(lines[lineIndex], prevTaskName);
    }

    const updatedText = lines.join('\n');
    editor.value = text.substring(0, lineStart) + updatedText + text.substring(lineEnd);

    // Restore selection to cover the modified lines
    editor.setSelectionRange(lineStart, lineStart + updatedText.length);

    // Trigger render
    editor.dispatchEvent(new Event('input', { bubbles: true }));
}

function initializeUploadTab() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');

    if (!dropZone || !fileInput || !uploadBtn) {
        console.error('Upload elements not found');
        return;
    }

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });
}

function initializeEditorDragDrop() {
    const editorPanel = document.querySelector('.editor-panel');
    const editorWrapper = document.querySelector('.editor-wrapper');
    const planEditor = document.getElementById('planEditor');

    if (!editorPanel || !editorWrapper || !planEditor) {
        console.error('Editor drag drop elements not found');
        return;
    }

    // Add drag over event to the editor panel
    editorPanel.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        editorPanel.classList.add('drag-over');
    });

    // Remove drag over styling when leaving
    editorPanel.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Only remove if we're actually leaving the editor panel
        if (!editorPanel.contains(e.relatedTarget)) {
            editorPanel.classList.remove('drag-over');
        }
    });

    // Handle file drop
    editorPanel.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        editorPanel.classList.remove('drag-over');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];

            // Check if it's a markdown file
            if (!file.name.match(/\.(md|txt)$/i)) {
                showMessage('editor', 'error', 'Please drop only Markdown (.md) or text (.txt) files');
                return;
            }

            if (file.size > 1048576) {
                showMessage('editor', 'error', 'File size must be less than 1MB');
                return;
            }

            handleEditorFileDrop(file);
        }
    });
}

async function handleEditorFileDrop(file) {
    try {
        // Clear existing plan data
        const planEditor = document.getElementById('planEditor');
        if (!planEditor) return;

        // Clear RAID log entries and highlights BEFORE loading new plan
        clearPlanTrackingData();

        // Read the file content
        const text = await file.text();

        // Clear the editor and load new content
        planEditor.value = text;

        // Trigger input event to update line numbers and syntax highlighting
        planEditor.dispatchEvent(new Event('input'));

        // Show success message
        showMessage('editor', 'success', `Loaded ${file.name} successfully`);

        // Auto-render the plan
        await renderText();

        console.log(`Loaded plan from ${file.name}`);

    } catch (error) {
        console.error('Error loading file:', error);
        showMessage('editor', 'error', 'Failed to load file: ' + error.message);
    }
}

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

    // Populate the editor with the file content
    const editor = document.getElementById('planEditor');
    editor.value = text;

    // Switch to the editor tab
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    const editorTab = document.querySelector('[onclick*="editor"]');
    if (editorTab) editorTab.classList.add('active');
    document.getElementById('editor-tab').classList.add('active');

    // Trigger input event to update line numbers and syntax highlighting
    editor.dispatchEvent(new Event('input'));

    // Render the plan
    await renderText();
}

async function renderText() {
    const text = document.getElementById('planEditor').value.trim();

    if (!text) {
        const output = document.getElementById('editorOutput');
        output.textContent = 'Press Enter in the editor to render your plan...';
        output.classList.add('empty');
        return;
    }

    await render(text, null, false, false, false, false, 'editor');
}

async function exportFile(format, prefix) {
    const text = document.getElementById('planEditor').value.trim();

    if (!text) {
        showMessage('editor', 'error', 'Please enter a plan to export');
        return;
    }

    // Close the export menu
    document.getElementById('exportMenu').classList.remove('show');

    // Set export flags based on format
    const exportExcel = format === 'excel';
    const exportCSV = format === 'csv';
    const exportPPT = format === 'ppt';
    const exportPDF = format === 'pdf';

    await render(text, null, exportExcel, exportCSV, exportPPT, exportPDF, prefix);
}

async function render(planText, projectName, exportExcel, exportCSV, exportPPT, exportPDF, prefix) {
    const btn = document.getElementById(prefix + 'Btn');
    const spinner = document.getElementById(prefix + 'Spinner');
    const message = document.getElementById(prefix + 'Message');
    const output = document.getElementById(prefix + 'Output');

    if (btn) btn.disabled = true;
    spinner.style.display = 'block';
    message.style.display = 'none';
    output.classList.remove('empty');

    try {
        const data = {
            plan_text: planText,
            project_name: projectName || null,
            export_excel: exportExcel,
            export_csv: exportCSV,
            export_ppt: exportPPT,
            export_pdf: exportPDF
        };

        const response = await fetch('/render', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Rendering failed');
        }

        const contentType = response.headers.get('content-type');

        if (contentType.includes('application/json')) {
            // ASCII output
            const result = await response.json();
            output.textContent = result.ascii_output;
            // No success message needed - silent render

            // Also update the Project Summary tab
            await updateProjectSummary(planText, projectName);
        } else {
            // Download file (ZIP, Excel, PowerPoint, or PDF)
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            // Determine filename and extension based on content type
            let filename = projectName || 'project';
            if (contentType.includes('application/zip')) {
                a.download = filename + '-exports.zip';
            } else if (contentType.includes('spreadsheetml.sheet')) {
                a.download = filename + '.xlsx';
            } else if (contentType.includes('presentationml.presentation')) {
                a.download = filename + '-timeline.pptx';
            } else if (contentType.includes('application/pdf')) {
                a.download = filename + '.pdf';
            } else {
                a.download = filename + '-export';
            }

            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            showMessage(prefix, 'success', 'File downloaded successfully!');
        }
    } catch (error) {
        showMessage(prefix, 'error', error.message);
        output.textContent = 'Error: ' + error.message;
        // Even when the render fails, try to extract and display highlights
        // from the plan text so the highlights tab is still populated.
        try {
            updateHighlightsView(extractHighlightsFromText(planText));
        } catch (e) {
            console.error('Failed to extract highlights as fallback:', e);
        }
    } finally {
        if (btn) btn.disabled = false;
        spinner.style.display = 'none';
    }
}

async function updateProjectSummary(planText, projectName) {
    try {
        const data = {
            plan_text: planText,
            project_name: projectName || null
        };

        const response = await fetch('/api/parse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            console.error('Failed to parse plan for summary');
            // Even if the API call failed, try to extract highlights
            // from the plan text on the client side as a fallback.
            updateHighlightsView(extractHighlightsFromText(planText));
            return;
        }

        const result = await response.json();

        // Always update highlights first (must be before updateReportPage
        // so highlightsData is populated when the report renders its
        // highlights quad).  Use backend data if available, otherwise
        // extract directly from the plan text as a fallback.
        const highlights = (result.highlights && result.highlights.length > 0)
            ? result.highlights
            : extractHighlightsFromText(planText);
        updateHighlightsView(highlights);

        // Show summary content, hide placeholder
        const placeholder = document.querySelector('#summary-view .summary-placeholder');
        const content = document.querySelector('#summary-view .summary-content');

        if (placeholder && content) {
            placeholder.style.display = 'none';
            content.style.display = 'block';
        }

        // Update project title
        const titleElement = document.getElementById('summaryTitle');
        if (titleElement) {
            titleElement.textContent = result.project_name || 'Untitled Project';
        }

        // Update front matter fields
        const frontMatter = result.front_matter || {};

        const managerElement = document.getElementById('summaryManager');
        if (managerElement) {
            managerElement.textContent = frontMatter['project manager'] || frontMatter.manager || frontMatter.owner || '-';
        }

        const sponsorElement = document.getElementById('summarySponsor');
        if (sponsorElement) {
            sponsorElement.textContent = frontMatter.sponsor || '-';
        }

        const budgetElement = document.getElementById('summaryBudget');
        if (budgetElement) {
            budgetElement.textContent = frontMatter.budget || '-';
        }

        const statusElement = document.getElementById('summaryStatus');
        if (statusElement) {
            statusElement.textContent = frontMatter.status || '-';
        }

        // Calculate RAG counts from the ASCII output
        // Parse the output to count Red, Amber, Green tasks
        const asciiOutput = result.ascii_output || '';
        const ragCounts = calculateRAGCounts(asciiOutput);

        const ragRedElement = document.getElementById('ragRedCount');
        if (ragRedElement) {
            ragRedElement.textContent = ragCounts.red;
        }

        const ragAmberElement = document.getElementById('ragAmberCount');
        if (ragAmberElement) {
            ragAmberElement.textContent = ragCounts.amber;
        }

        const ragGreenElement = document.getElementById('ragGreenCount');
        if (ragGreenElement) {
            ragGreenElement.textContent = ragCounts.green;
        }

        // Store resource map globally BEFORE updating tables that need it
        globalResourceMap = result.resource_map || {};
        globalResourceDetails = parseResourceDetails(planText);

        // Update Milestones Table
        updateMilestonesTable(result.tasks || []);

        // Update Project Report page
        updateReportPage(result.tasks || [], result.project_name, result.front_matter || {});

        // Update Resources Table (needs globalResourceMap to be set first)
        updateResourcesTable(result.tasks || []);

        // Update Timesheet
        updateTimesheet(result.tasks || [], result.front_matter || {});

        // Update Timeline
        updateTimeline(result.tasks || [], result.project_name);

        // Load conditional formatting rules before rendering
        loadConditionalFormattingRulesFromFrontMatter();

        // Update Gantt Chart
        updateGantt(result.tasks || []);

        // Update Analysis (pass planText directly since front_matter might be an object)
        updateAnalysis(planText, result.tasks || [], planText, result.resource_map || {});

        // Update 2-Week Look-Ahead
        updateLookAhead(result.tasks || []);

        // Update User Workload
        updateUserWorkload(result.tasks || []);

        // Update Resource Sheet
        updateResourceSheet(result.tasks || [], result.front_matter || {});

        // Load RAID items from backend data, with client-side fallback
        const raidFromApi = result.raid_items || [];
        if (raidFromApi.length > 0) {
            loadRaidItemsFromData(raidFromApi);
        } else {
            const raidFromText = extractRaidItemsFromPlanText(planText);
            loadRaidItemsFromData(raidFromText);
        }

        // Update editor with labels if backend found and added them
        if (result.updated_plan_text && result.updated_plan_text !== planText) {
            console.log('Backend returned updated plan text with labels');
            console.log('Original length:', planText.length);
            console.log('Updated length:', result.updated_plan_text.length);
            const editor = document.getElementById('planEditor');
            if (editor) {
                // Update editor value without triggering another parse
                // The current parse already has the updated data
                editor.value = result.updated_plan_text;
                updateLineNumbers();
            }
        }

    } catch (error) {
        console.error('Error updating project summary:', error);
        // Fallback: extract highlights and RAID items from plan text on the
        // client side so those tabs are populated even when parsing fails.
        try {
            updateHighlightsView(extractHighlightsFromText(planText));
        } catch (e) {
            console.error('Failed to extract highlights as fallback:', e);
        }
        try {
            loadRaidItemsFromData(extractRaidItemsFromPlanText(planText));
        } catch (e) {
            console.error('Failed to extract RAID items as fallback:', e);
        }
    }
}

function updateMilestonesTable(tasks) {
    try {
        // Show milestones content, hide placeholder
        const placeholder = document.querySelector('#milestones-view .milestones-placeholder');
        const content = document.querySelector('#milestones-view .milestones-content');

        if (placeholder && content) {
            placeholder.style.display = 'none';
            content.style.display = 'block';
        }

        // Get table body
        const tbody = document.getElementById('milestonesTableBody');
        if (!tbody) {
            console.error('Milestones table body not found');
            return;
        }

        // Clear existing rows
        tbody.innerHTML = '';

        // Filter to only show actual milestones (0-duration, non-summary tasks)
        const filteredTasks = tasks.filter(task => {
            return task.duration_days === 0 && !task.is_summary;
        });

        // Populate with milestone data
        filteredTasks.forEach(task => {
            const row = document.createElement('tr');

            // ID cell
            const idCell = document.createElement('td');
            idCell.textContent = task.id;
            row.appendChild(idCell);

            // Task Name cell
            const nameCell = document.createElement('td');
            nameCell.textContent = task.name;
            nameCell.classList.add('task-name');
            row.appendChild(nameCell);

            // Start cell
            const startCell = document.createElement('td');
            startCell.textContent = task.start || '-';
            row.appendChild(startCell);

            // Finish cell
            const finishCell = document.createElement('td');
            finishCell.textContent = task.finish || '-';
            row.appendChild(finishCell);

            // Percent cell
            const percentCell = document.createElement('td');
            percentCell.textContent = task.percent || '-';
            row.appendChild(percentCell);

            // RAG cell
            const ragCell = document.createElement('td');
            ragCell.textContent = task.rag || '-';
            if (task.rag) {
                ragCell.classList.add(`rag-${task.rag.toLowerCase()}`);
            }
            row.appendChild(ragCell);

            // Priority cell
            const priorityCell = document.createElement('td');
            const priorityVal = task.priority || 'Low';
            priorityCell.textContent = priorityVal;
            if (priorityVal === 'Urgent') {
                priorityCell.classList.add('priority-urgent');
            } else if (priorityVal === 'Important') {
                priorityCell.classList.add('priority-important');
            } else if (priorityVal === 'Medium') {
                priorityCell.classList.add('priority-medium');
            }
            row.appendChild(priorityCell);

            // Bucket cell
            const bucketCell = document.createElement('td');
            bucketCell.textContent = task.bucket || '-';
            row.appendChild(bucketCell);

            // Comment cell
            const commentCell = document.createElement('td');
            commentCell.textContent = task.comment || '-';
            row.appendChild(commentCell);

            // Make row clickable to open task form
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
                openMilestoneTaskForm(task.name);
            });

            tbody.appendChild(row);
        });

    } catch (error) {
        console.error('Error updating milestones table:', error);
    }
}

function updateReportPage(tasks, projectName, frontMatter) {
    try {
        // Show report content, hide placeholder
        const placeholder = document.querySelector('#project-report-view .project-report-placeholder');
        const content = document.querySelector('#project-report-view .project-report-content');

        if (placeholder && content) {
            placeholder.style.display = 'none';
            content.style.display = 'block';
        }

        // Populate project info header
        const titleEl = document.getElementById('reportProjectTitle');
        if (titleEl) {
            titleEl.textContent = projectName || 'Untitled Project';
        }

        // Project manager
        const manager = frontMatter['project manager'] || frontMatter.manager || frontMatter.owner || '';
        const managerDetail = document.getElementById('reportManagerDetail');
        const managerEl = document.getElementById('reportManager');
        if (managerDetail && managerEl) {
            if (manager) {
                managerEl.textContent = manager;
                managerDetail.style.display = '';
            } else {
                managerDetail.style.display = 'none';
            }
        }

        // Sponsor
        const sponsor = frontMatter.sponsor || '';
        const sponsorDetail = document.getElementById('reportSponsorDetail');
        const sponsorEl = document.getElementById('reportSponsor');
        if (sponsorDetail && sponsorEl) {
            if (sponsor) {
                sponsorEl.textContent = sponsor;
                sponsorDetail.style.display = '';
            } else {
                sponsorDetail.style.display = 'none';
            }
        }

        // Budget
        const budget = frontMatter.budget || '';
        const budgetDetail = document.getElementById('reportBudgetDetail');
        const budgetEl = document.getElementById('reportBudget');
        if (budgetDetail && budgetEl) {
            if (budget) {
                budgetEl.textContent = budget;
                budgetDetail.style.display = '';
            } else {
                budgetDetail.style.display = 'none';
            }
        }

        // Project RAG status
        const status = frontMatter.status || '';
        const statusDetail = document.getElementById('reportStatusDetail');
        const statusEl = document.getElementById('reportStatus');
        if (statusDetail && statusEl) {
            if (status) {
                statusEl.innerHTML = '';
                const badge = document.createElement('span');
                badge.className = 'report-rag-badge';
                const lower = status.toLowerCase();
                if (lower === 'red' || lower === 'amber' || lower === 'green') {
                    badge.classList.add('rag-' + lower);
                }
                badge.textContent = status;
                statusEl.appendChild(badge);
                statusDetail.style.display = '';
            } else {
                statusDetail.style.display = 'none';
            }
        }

        // Current date
        const dateEl = document.getElementById('reportDate');
        if (dateEl) {
            const now = new Date();
            dateEl.textContent = now.toISOString().split('T')[0];
        }

        // Render simple timeline (no phases, no detailed view)
        updateReportTimeline(tasks, projectName);

        // Populate quad sections
        updateReportMilestones(tasks);
        updateReportRaid();
        updateReportHighlight();

    } catch (error) {
        console.error('Error updating report page:', error);
    }
}

function updateReportTimeline(tasks, projectName) {
    try {
        // Filter to tasks with valid dates for computing the date range
        const allTasks = tasks.filter(t => (t.start && t.finish) || (t.finish && t.duration_days === 0));
        if (allTasks.length === 0) return;

        // Find min and max dates across all tasks (phases + milestones)
        const allDates = [];
        allTasks.forEach(t => {
            if (t.start) allDates.push(parseLocalDate(t.start));
            if (t.finish) allDates.push(parseLocalDate(t.finish));
        });
        const minDate = new Date(Math.min(...allDates));
        const maxDate = new Date(Math.max(...allDates));

        // Add padding
        minDate.setDate(minDate.getDate() - 7);
        maxDate.setDate(maxDate.getDate() + 7);

        // Calculate timeline width from available container
        const timelineWrapper = document.querySelector('.report-timeline-wrapper');

        // Skip if container is hidden
        if (timelineWrapper && timelineWrapper.offsetWidth === 0) return;

        const availableWidth = timelineWrapper ? timelineWrapper.offsetWidth - 100 : 1200;
        const timelineWidth = Math.max(800, availableWidth);
        const totalDays = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24)) + 1;

        // Always render the minimal view on the report page
        renderMinimalTimeline(timelineWrapper, tasks, minDate, maxDate, totalDays, timelineWidth, { isReport: true });

    } catch (error) {
        console.error('Error updating report timeline:', error);
    }
}

function updateReportMilestones(tasks) {
    try {
        const tbody = document.getElementById('reportMilestonesTableBody');
        const emptyEl = document.getElementById('reportMilestonesEmpty');
        const tableEl = tbody ? tbody.closest('table') : null;
        if (!tbody) return;

        tbody.innerHTML = '';

        // Filter to only milestones (0-duration, non-summary tasks)
        const allMilestones = tasks.filter(task => task.duration_days === 0 && !task.is_summary);

        // Separate incomplete from complete, sort incomplete by date
        const incomplete = allMilestones
            .filter(task => (parseFloat(task.percent) || 0) < 100)
            .sort((a, b) => {
                const dateA = a.finish ? new Date(a.finish) : new Date('9999-12-31');
                const dateB = b.finish ? new Date(b.finish) : new Date('9999-12-31');
                return dateA - dateB;
            });

        // Take next 10 incomplete milestones
        const displayMilestones = incomplete.slice(0, 10);

        if (displayMilestones.length === 0) {
            if (tableEl) tableEl.style.display = 'none';
            if (emptyEl) emptyEl.style.display = 'block';
            return;
        }

        if (tableEl) tableEl.style.display = '';
        if (emptyEl) emptyEl.style.display = 'none';

        displayMilestones.forEach(task => {
            const row = document.createElement('tr');

            const nameCell = document.createElement('td');
            nameCell.textContent = task.name;
            nameCell.classList.add('task-name');
            row.appendChild(nameCell);

            const dateCell = document.createElement('td');
            dateCell.textContent = task.finish || '-';
            row.appendChild(dateCell);

            const ragCell = document.createElement('td');
            const ragValue = task.rag || '-';
            ragCell.textContent = ragValue;
            if (task.rag) {
                ragCell.classList.add('rag-' + task.rag.toLowerCase());
            }
            row.appendChild(ragCell);

            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
                openMilestoneTaskForm(task.name);
            });

            tbody.appendChild(row);
        });

    } catch (error) {
        console.error('Error updating report milestones:', error);
    }
}

/**
 * Populate the report RAID quad with open risks and issues,
 * sorted by score (highest first), limited to 10 items.
 */
function updateReportRaid() {
    try {
        const tbody = document.getElementById('reportRaidTableBody');
        const emptyEl = document.getElementById('reportRaidEmpty');
        const tableEl = document.getElementById('reportRaidTable');
        if (!tbody) return;

        tbody.innerHTML = '';

        // Filter to open risks and issues only, sort by score descending
        const openRisksAndIssues = raidItems
            .filter(item => (item.type === 'risk' || item.type === 'issue') && item.status === 'open')
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .slice(0, 10);

        if (openRisksAndIssues.length === 0) {
            if (tableEl) tableEl.style.display = 'none';
            if (emptyEl) emptyEl.style.display = 'block';
            return;
        }

        if (tableEl) tableEl.style.display = '';
        if (emptyEl) emptyEl.style.display = 'none';

        openRisksAndIssues.forEach(item => {
            const row = document.createElement('tr');
            row.style.cursor = 'pointer';
            row.title = 'Click to view details';
            row.addEventListener('click', () => openRaidForm(item.id));

            const typeCell = document.createElement('td');
            const typeBadge = document.createElement('span');
            typeBadge.className = 'raid-type-badge raid-type-' + item.type;
            typeBadge.textContent = item.type;
            typeCell.appendChild(typeBadge);
            row.appendChild(typeCell);

            const titleCell = document.createElement('td');
            titleCell.textContent = item.title || item.description || '-';
            row.appendChild(titleCell);

            const scoreCell = document.createElement('td');
            const scoreBadge = document.createElement('span');
            const score = item.score || 0;
            const scoreClass = score >= 16 ? 'raid-score-high' : score >= 6 ? 'raid-score-medium' : 'raid-score-low';
            scoreBadge.className = 'raid-score ' + scoreClass;
            scoreBadge.textContent = score;
            scoreCell.appendChild(scoreBadge);
            row.appendChild(scoreCell);

            tbody.appendChild(row);
        });

    } catch (error) {
        console.error('Error updating report RAID:', error);
    }
}

/**
 * Show the most recent highlight entry in the report quad.
 */
function updateReportHighlight() {
    try {
        const container = document.getElementById('reportHighlightContent');
        if (!container) return;

        if (!highlightsData || highlightsData.length === 0) {
            container.innerHTML = '<p class="quad-empty-state">No highlights recorded yet.</p>';
            return;
        }

        // Find the most recent highlight by date
        const latest = highlightsData.reduce((newest, current) => {
            if (!newest) return current;
            return (current.date > newest.date) ? current : newest;
        }, null);

        container.innerHTML = '';

        const card = document.createElement('div');
        card.className = 'report-highlight-card';

        const meta = document.createElement('div');
        meta.className = 'report-highlight-meta';

        if (latest.date) {
            const dateSpan = document.createElement('span');
            dateSpan.className = 'highlight-date';
            dateSpan.textContent = latest.date;
            meta.appendChild(dateSpan);
        }

        if (latest.author) {
            const authorSpan = document.createElement('span');
            authorSpan.className = 'highlight-author';
            authorSpan.textContent = '@' + latest.author;
            meta.appendChild(authorSpan);
        }

        card.appendChild(meta);

        const body = document.createElement('div');
        body.className = 'report-highlight-body';
        body.innerHTML = renderSimpleMarkdown(latest.content || '');
        card.appendChild(body);

        container.appendChild(card);

    } catch (error) {
        console.error('Error updating report highlight:', error);
    }
}

function updateResourcesTable(tasks) {
    try {
        // Show resources content, hide placeholder
        const placeholder = document.querySelector('#resources-view .resources-placeholder');
        const content = document.querySelector('#resources-view .resources-content');

        if (placeholder && content) {
            placeholder.style.display = 'none';
            content.style.display = 'block';
        }

        // Get table body
        const tbody = document.getElementById('resourcesTableBody');
        if (!tbody) {
            console.error('Resources table body not found');
            return;
        }

        // Clear existing rows
        tbody.innerHTML = '';

        // Build reverse lookup map: full name -> shortname
        const fullNameToShortname = {};
        Object.keys(globalResourceMap).forEach(shortname => {
            const fullName = globalResourceMap[shortname];
            if (fullName) {
                fullNameToShortname[fullName.toLowerCase()] = shortname;
            }
        });

        // Aggregate resource data from tasks
        const resourceData = {};

        tasks.forEach(task => {
            // Skip summary tasks and tasks without resources
            if (task.is_summary || !task.resources) {
                return;
            }

            // Parse resources (may be comma-separated)
            const resources = task.resources.split(',').map(r => r.trim()).filter(r => r && r !== '-');

            resources.forEach(resource => {
                if (!resourceData[resource]) {
                    // Look up shortname from full name
                    const shortname = fullNameToShortname[resource.toLowerCase()] || resource;

                    resourceData[resource] = {
                        name: resource,
                        shortname: shortname,
                        taskCount: 0,
                        totalDays: 0,
                        totalHours: 0
                    };
                }

                resourceData[resource].taskCount++;
                resourceData[resource].totalDays += task.duration_days || 0;
                resourceData[resource].totalHours += (task.duration_days || 0) * 8;
            });
        });

        // Convert to array and sort by name
        const sortedResources = Object.values(resourceData).sort((a, b) =>
            a.name.localeCompare(b.name)
        );

        // Populate table rows
        sortedResources.forEach(resource => {
            const row = document.createElement('tr');

            // Full Name cell (editable on double-click)
            const nameCell = document.createElement('td');
            nameCell.textContent = resource.name;
            nameCell.classList.add('resource-name');
            nameCell.style.cursor = 'pointer';
            nameCell.title = 'Double-click to edit resource';
            nameCell.addEventListener('dblclick', () => {
                const shortname = resource.shortname || resource.name.replace(/^@/, '');
                openResourceForm(shortname);
            });
            row.appendChild(nameCell);

            // Shortname cell (editable on double-click)
            const shortnameCell = document.createElement('td');
            const displayShortname = resource.shortname || resource.name;
            shortnameCell.textContent = '@' + displayShortname;
            shortnameCell.classList.add('resource-shortname');
            shortnameCell.style.cursor = 'pointer';
            shortnameCell.title = 'Double-click to rename shortname';
            shortnameCell.addEventListener('dblclick', () => {
                startInlineRename(shortnameCell, displayShortname);
            });
            row.appendChild(shortnameCell);

            // Role cell
            const roleCell = document.createElement('td');
            const details = globalResourceDetails[displayShortname.toLowerCase()];
            roleCell.textContent = details ? details.role : '';
            row.appendChild(roleCell);

            // Tasks Assigned cell
            const tasksCell = document.createElement('td');
            tasksCell.textContent = resource.taskCount;
            tasksCell.classList.add('text-center');
            row.appendChild(tasksCell);

            // Total Days cell
            const daysCell = document.createElement('td');
            daysCell.textContent = resource.totalDays;
            daysCell.classList.add('text-center');
            row.appendChild(daysCell);

            // Total Hours cell
            const hoursCell = document.createElement('td');
            hoursCell.textContent = resource.totalHours;
            hoursCell.classList.add('text-center');
            row.appendChild(hoursCell);

            tbody.appendChild(row);
        });

        // Add totals row if there are resources
        if (sortedResources.length > 0) {
            const totalRow = document.createElement('tr');
            totalRow.classList.add('totals-row');

            const totalLabelCell = document.createElement('td');
            totalLabelCell.textContent = 'Total';
            totalLabelCell.style.fontWeight = 'bold';
            totalRow.appendChild(totalLabelCell);

            // Empty shortname cell for totals row
            const emptyCell = document.createElement('td');
            totalRow.appendChild(emptyCell);

            // Empty role cell for totals row
            const emptyRoleCell = document.createElement('td');
            totalRow.appendChild(emptyRoleCell);

            const totalTasksCell = document.createElement('td');
            totalTasksCell.textContent = sortedResources.reduce((sum, r) => sum + r.taskCount, 0);
            totalTasksCell.classList.add('text-center');
            totalTasksCell.style.fontWeight = 'bold';
            totalRow.appendChild(totalTasksCell);

            const totalDaysCell = document.createElement('td');
            totalDaysCell.textContent = sortedResources.reduce((sum, r) => sum + r.totalDays, 0);
            totalDaysCell.classList.add('text-center');
            totalDaysCell.style.fontWeight = 'bold';
            totalRow.appendChild(totalDaysCell);

            const totalHoursCell = document.createElement('td');
            totalHoursCell.textContent = sortedResources.reduce((sum, r) => sum + r.totalHours, 0);
            totalHoursCell.classList.add('text-center');
            totalHoursCell.style.fontWeight = 'bold';
            totalRow.appendChild(totalHoursCell);

            tbody.appendChild(totalRow);
        }

    } catch (error) {
        console.error('Error updating resources table:', error);
    }
}

// Inline rename for resource shortname in the resources table
function startInlineRename(cell, currentShortname) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentShortname;
    input.className = 'resource-inline-edit';
    input.style.width = '100%';
    input.style.padding = '2px 4px';
    input.style.border = '1px solid #4a6fa5';
    input.style.borderRadius = '3px';
    input.style.fontSize = 'inherit';

    const originalText = cell.textContent;
    cell.textContent = '';
    cell.appendChild(input);
    input.focus();
    input.select();

    function finishEdit() {
        const newShortname = input.value.trim();
        if (newShortname && newShortname !== currentShortname) {
            renameResourceShortname(currentShortname, newShortname);
            cell.textContent = '@' + newShortname;
        } else {
            cell.textContent = originalText;
        }
    }

    input.addEventListener('blur', finishEdit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        } else if (e.key === 'Escape') {
            input.value = currentShortname; // Reset to original
            input.blur();
        }
    });
}

// Rename a resource shortname throughout the plan text
function renameResourceShortname(oldShortname, newShortname) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    let content = editor.value;

    // Replace in front matter resource definition: @oldname: -> @newname:
    content = content.replace(
        new RegExp(`(@${oldShortname})(\\s*:)`, 'gi'),
        `@${newShortname}$2`
    );

    // Replace @oldname references in task lines (not in front matter definition)
    // Match @oldname followed by word boundary (space, comma, bracket, end of line)
    content = content.replace(
        new RegExp(`@${oldShortname}\\b`, 'g'),
        `@${newShortname}`
    );

    editor.value = content;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
}

// Fix resource names - capitalise first letter of all resource shortnames
function fixResourceNames() {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    let content = editor.value;
    let changesMade = false;

    // Find all @shortname references and capitalise first letter
    content = content.replace(/@([a-z])(\w*)/g, (match, firstChar, rest) => {
        changesMade = true;
        return '@' + firstChar.toUpperCase() + rest;
    });

    if (changesMade) {
        editor.value = content;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

/**
 * Check if a date is a weekend (Saturday or Sunday)
 */
function isWeekend(date) {
    const day = date.getDay();
    return day === 0 || day === 6; // Sunday = 0, Saturday = 6
}

/**
 * Check if a date is a working day (not weekend and not holiday)
 */
function isWorkingDay(date, holidays = []) {
    if (isWeekend(date)) {
        return false;
    }

    const dateStr = date.toISOString().split('T')[0];
    return !holidays.includes(dateStr);
}

/**
 * Count working days between two dates (inclusive)
 */
function countWorkingDays(startDate, endDate, holidays = []) {
    let count = 0;
    const current = new Date(startDate);

    while (current <= endDate) {
        if (isWorkingDay(current, holidays)) {
            count++;
        }
        current.setDate(current.getDate() + 1);
    }

    return count;
}

/**
 * Get list of all working days between two dates
 */
function getWorkingDays(startDate, endDate, holidays = []) {
    const workingDays = [];
    const current = new Date(startDate);

    while (current <= endDate) {
        if (isWorkingDay(current, holidays)) {
            workingDays.push(new Date(current));
        }
        current.setDate(current.getDate() + 1);
    }

    return workingDays;
}

function updateTimesheet(tasks, frontMatter = {}) {
    try {
        // Show timesheet content, hide placeholder
        const placeholder = document.querySelector('#timesheet-view .timesheet-placeholder');
        const content = document.querySelector('#timesheet-view .timesheet-content');

        if (placeholder && content) {
            placeholder.style.display = 'none';
            content.style.display = 'block';
        }

        // Parse holidays from front matter
        const holidays = [];
        if (frontMatter.holidays) {
            // Holidays can be a string or array in front matter
            const holidayStr = typeof frontMatter.holidays === 'string' ? frontMatter.holidays : '';
            // Parse dates in format like "2025-01-01, 2025-12-25" or YAML list format
            const holidayMatches = holidayStr.match(/\d{4}-\d{2}-\d{2}/g);
            if (holidayMatches) {
                holidays.push(...holidayMatches);
            }
        }

        // Get table elements
        const monthRow = document.getElementById('timesheetMonthRow');
        const dayRow = document.getElementById('timesheetDayRow');
        const weekdayRow = document.getElementById('timesheetWeekdayRow');
        const tbody = document.getElementById('timesheetBody');
        if (!monthRow || !dayRow || !weekdayRow || !tbody) {
            console.error('Timesheet table elements not found');
            return;
        }

        // Clear existing content
        // Keep the first header cell (Resource) in monthRow, remove date columns from all rows
        while (monthRow.children.length > 1) {
            monthRow.removeChild(monthRow.lastChild);
        }
        dayRow.innerHTML = '';
        weekdayRow.innerHTML = '';
        tbody.innerHTML = '';

        // Filter out tasks without dates or resources
        const tasksWithDates = tasks.filter(t =>
            !t.is_summary && t.start && t.finish && t.resources && t.resources !== '-'
        );

        if (tasksWithDates.length === 0) {
            tbody.innerHTML = '<tr><td colspan="100%" style="text-align: center; padding: 20px;">No tasks with resources and dates found</td></tr>';
            return;
        }

        // Find date range
        let minDate = null;
        let maxDate = null;
        tasksWithDates.forEach(task => {
            const start = new Date(task.start);
            const finish = new Date(task.finish);
            if (!minDate || start < minDate) minDate = start;
            if (!maxDate || finish > maxDate) maxDate = finish;
        });

        // Generate array of all dates in range
        const dates = [];
        const currentDate = new Date(minDate);
        // Normalize to midnight to avoid DST issues
        currentDate.setHours(12, 0, 0, 0); // Use noon to avoid DST transitions

        while (currentDate <= maxDate) {
            const dateToAdd = new Date(currentDate);
            dateToAdd.setHours(12, 0, 0, 0); // Normalize each date
            dates.push(dateToAdd);
            currentDate.setDate(currentDate.getDate() + 1);
        }

        // Add date header columns in three rows: month names, day numbers, weekday initials
        // First, group dates by month for month row spanning
        const monthGroups = [];
        let currentMonth = null;
        let currentMonthCount = 0;

        dates.forEach(date => {
            const monthName = date.toLocaleDateString('en-US', { month: 'long' });
            const monthYear = `${monthName} ${date.getFullYear()}`;

            if (monthYear !== currentMonth) {
                if (currentMonth !== null) {
                    monthGroups.push({ name: currentMonth, count: currentMonthCount });
                }
                currentMonth = monthYear;
                currentMonthCount = 1;
            } else {
                currentMonthCount++;
            }
        });
        // Add the last month group
        if (currentMonth !== null) {
            monthGroups.push({ name: currentMonth, count: currentMonthCount });
        }

        // Create month row headers
        monthGroups.forEach(group => {
            const th = document.createElement('th');
            th.className = 'timesheet-month-header';
            th.setAttribute('colspan', group.count);
            th.textContent = group.name;
            monthRow.appendChild(th);
        });

        // Create day and weekday rows
        dates.forEach(date => {
            const dayOfWeekNum = date.getDay();
            const dateKey = date.toISOString().split('T')[0];
            const isWeekend = dayOfWeekNum === 0 || dayOfWeekNum === 6;
            const isHoliday = holidays.includes(dateKey);

            // Day number header
            const dayTh = document.createElement('th');
            dayTh.className = 'timesheet-day-header';
            dayTh.textContent = date.getDate();
            if (isWeekend) dayTh.classList.add('timesheet-weekend');
            if (isHoliday) dayTh.classList.add('timesheet-holiday');
            dayRow.appendChild(dayTh);

            // Weekday initial header
            const weekdayTh = document.createElement('th');
            weekdayTh.className = 'timesheet-weekday-header';
            const weekdayInitials = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
            weekdayTh.textContent = weekdayInitials[dayOfWeekNum];
            if (isWeekend) weekdayTh.classList.add('timesheet-weekend');
            if (isHoliday) weekdayTh.classList.add('timesheet-holiday');
            weekdayRow.appendChild(weekdayTh);
        });

        // Aggregate resource data
        const resourceData = {};

        tasksWithDates.forEach(task => {
            const resources = task.resources.split(',').map(r => r.trim()).filter(r => r && r !== '-');
            const taskStart = new Date(task.start);
            const taskFinish = new Date(task.finish);

            // Get only working days for this task
            const workingDays = getWorkingDays(taskStart, taskFinish, holidays);
            const numWorkingDays = workingDays.length;

            if (numWorkingDays === 0) {
                return; // Skip task if no working days
            }

            // Calculate hours per working day
            // task.duration_days is already in working days, so we use 8 hours per day
            const totalHours = task.duration_days * 8;
            const hoursPerResource = totalHours / resources.length;
            const hoursPerDay = hoursPerResource / numWorkingDays;

            resources.forEach(resource => {
                // Parse resource allocation percentage (e.g., "JD[50%]" means 50% allocation)
                let resourceName = resource;
                let allocationPercent = 100; // Default to 100%

                const allocationMatch = resource.match(/^(.+?)\[(\d+)%\]$/);
                if (allocationMatch) {
                    resourceName = allocationMatch[1].trim();
                    allocationPercent = parseInt(allocationMatch[2]);
                }

                if (!resourceData[resourceName]) {
                    resourceData[resourceName] = {};
                }

                // Distribute hours only across working days
                workingDays.forEach(date => {
                    const dateKey = date.toISOString().split('T')[0];
                    if (!resourceData[resourceName][dateKey]) {
                        resourceData[resourceName][dateKey] = 0;
                    }
                    // Apply allocation percentage
                    const adjustedHours = hoursPerDay * (allocationPercent / 100);
                    resourceData[resourceName][dateKey] += adjustedHours;
                });
            });
        });

        // Sort resources by name
        const sortedResources = Object.keys(resourceData).sort();

        // Populate table rows
        sortedResources.forEach(resource => {
            const row = document.createElement('tr');

            // Resource name cell
            const nameCell = document.createElement('td');
            nameCell.textContent = resource;
            nameCell.className = 'timesheet-resource-name';
            nameCell.style.cursor = 'pointer';
            nameCell.addEventListener('dblclick', () => {
                // Strip @ symbol if present before passing to form
                const shortname = resource.replace(/^@/, '');
                openResourceForm(shortname);
            });
            row.appendChild(nameCell);

            // Add cell for each date
            dates.forEach(date => {
                const dateKey = date.toISOString().split('T')[0];
                const cell = document.createElement('td');
                cell.className = 'timesheet-hours-cell';

                const hours = resourceData[resource][dateKey] || 0;
                if (hours > 0) {
                    cell.textContent = hours.toFixed(1);

                    // Color code by hours
                    if (hours <= 4) {
                        cell.classList.add('timesheet-hours-low');
                    } else if (hours <= 8) {
                        cell.classList.add('timesheet-hours-normal');
                    } else {
                        cell.classList.add('timesheet-hours-high');
                    }
                } else {
                    cell.textContent = '-';
                    cell.classList.add('timesheet-hours-none');
                }

                // Add weekend and holiday classes
                const dayOfWeek = date.getDay();
                if (dayOfWeek === 0 || dayOfWeek === 6) {
                    cell.classList.add('timesheet-weekend');
                }

                // Check if it's a holiday
                if (holidays.includes(dateKey)) {
                    cell.classList.add('timesheet-holiday');
                }

                row.appendChild(cell);
            });

            tbody.appendChild(row);
        });

    } catch (error) {
        console.error('Error updating timesheet:', error);
    }
}

// Store tasks and project name for timeline re-rendering
let timelineTasks = [];
let timelineProjectName = '';
let detailedTimelineEnabled = false;
let minimalTimelineEnabled = false;

function renderDetailedPhaseBlocks(container, tasks, minDate, maxDate, totalDays, timelineWidth) {
    // Remove existing detailed timeline if present
    const existing = container.querySelector('.detailed-timeline-container');
    if (existing) {
        existing.remove();
    }

    const isDetailedOn = document.getElementById('detailedTimelineToggle')?.checked ?? false;
    if (!isDetailedOn) return;

    // Get phase (summary) tasks with valid start and finish dates
    const phases = tasks.filter(t => t.is_summary && t.start && t.finish);
    if (phases.length === 0) return;

    // Assign rows using overlap detection
    const rows = assignPhaseRows(phases, minDate, totalDays, timelineWidth);
    const numRows = Math.max(...rows.map(r => r.row)) + 1;

    // Calculate row height: total phase area height <= 20% of timeline width
    const maxPhaseAreaHeight = timelineWidth * 0.20;
    const rowHeight = Math.min(40, Math.max(16, Math.floor(maxPhaseAreaHeight / numRows)));
    const phaseAreaHeight = rowHeight * numRows;
    const padding = 4;

    // Create SVG container for phase blocks
    const svgContainer = document.createElement('div');
    svgContainer.className = 'detailed-timeline-container';
    svgContainer.style.width = timelineWidth + 'px';
    svgContainer.style.height = phaseAreaHeight + 'px';
    svgContainer.style.margin = '0 auto 12px auto';

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', timelineWidth);
    svg.setAttribute('height', phaseAreaHeight);
    svg.setAttribute('class', 'detailed-timeline-svg');

    // Define blue shades from darker to lighter (for incomplete phases)
    const blueShades = ['#1565c0', '#1976d2', '#1e88e5', '#2196f3', '#42a5f5', '#64b5f6', '#90caf9'];
    const greenComplete = '#4caf50';

    rows.forEach((phaseInfo, index) => {
        const phase = phaseInfo.phase;
        const row = phaseInfo.row;
        const percent = parseFloat(phase.percent) || 0;
        const isComplete = percent >= 100;

        const phaseStart = parseLocalDate(phase.start);
        const phaseEnd = parseLocalDate(phase.finish);
        const startDays = Math.floor((phaseStart - minDate) / (1000 * 60 * 60 * 24));
        const endDays = Math.floor((phaseEnd - minDate) / (1000 * 60 * 60 * 24));

        const x = Math.max(0, (startDays / totalDays) * timelineWidth);
        const xEnd = Math.min(timelineWidth, (endDays / totalDays) * timelineWidth);
        const width = Math.max(2, xEnd - x);
        const y = row * rowHeight;
        const blockHeight = rowHeight - padding;

        // Background colour for the phase block
        let bgColor;
        if (isComplete) {
            bgColor = greenComplete;
        } else {
            // Assign blue shade based on index (cycling through shades)
            bgColor = blueShades[index % blueShades.length];
        }

        // Draw the full phase block (background)
        const bgRect = document.createElementNS(svgNS, 'rect');
        bgRect.setAttribute('x', x);
        bgRect.setAttribute('y', y);
        bgRect.setAttribute('width', width);
        bgRect.setAttribute('height', blockHeight);
        bgRect.setAttribute('rx', 3);
        bgRect.setAttribute('ry', 3);
        bgRect.setAttribute('fill', bgColor);
        bgRect.setAttribute('opacity', '0.7');
        bgRect.setAttribute('class', 'timeline-clickable');
        bgRect.style.cursor = 'pointer';
        bgRect.addEventListener('click', () => openMilestoneTaskForm(phase.name));
        svg.appendChild(bgRect);

        // Draw the percent complete overlay (darker shade on the left portion)
        if (percent > 0 && percent < 100) {
            const progressWidth = (percent / 100) * width;
            const darkerColor = darkenColor(bgColor, 0.35);
            const progressRect = document.createElementNS(svgNS, 'rect');
            progressRect.setAttribute('x', x);
            progressRect.setAttribute('y', y);
            progressRect.setAttribute('width', progressWidth);
            progressRect.setAttribute('height', blockHeight);
            progressRect.setAttribute('rx', 3);
            progressRect.setAttribute('ry', 3);
            progressRect.setAttribute('fill', darkerColor);
            progressRect.setAttribute('opacity', '0.9');
            progressRect.setAttribute('class', 'timeline-clickable');
            progressRect.style.cursor = 'pointer';
            progressRect.addEventListener('click', () => openMilestoneTaskForm(phase.name));
            svg.appendChild(progressRect);
        }

        // For completed phases, use a darker green for the full block
        if (isComplete) {
            bgRect.setAttribute('fill', greenComplete);
            bgRect.setAttribute('opacity', '0.9');
        }

        // Add phase title text (clipped to block width)
        const fontSize = Math.min(12, Math.max(9, blockHeight - 6));
        const clipId = 'phase-clip-' + index;
        const clipPath = document.createElementNS(svgNS, 'clipPath');
        clipPath.setAttribute('id', clipId);
        const clipRect = document.createElementNS(svgNS, 'rect');
        clipRect.setAttribute('x', x + 4);
        clipRect.setAttribute('y', y);
        clipRect.setAttribute('width', Math.max(0, width - 8));
        clipRect.setAttribute('height', blockHeight);
        clipPath.appendChild(clipRect);
        svg.appendChild(clipPath);

        const text = document.createElementNS(svgNS, 'text');
        text.setAttribute('x', x + 6);
        text.setAttribute('y', y + blockHeight / 2);
        text.setAttribute('dominant-baseline', 'central');
        text.setAttribute('font-size', fontSize + 'px');
        text.setAttribute('fill', '#ffffff');
        text.setAttribute('font-weight', '600');
        text.setAttribute('clip-path', 'url(#' + clipId + ')');
        text.textContent = isComplete ? '✓ ' + phase.name : phase.name;
        text.style.cursor = 'pointer';
        text.addEventListener('click', () => openMilestoneTaskForm(phase.name));
        svg.appendChild(text);

        // Add tooltip
        const title = document.createElementNS(svgNS, 'title');
        title.textContent = phase.name + ' (' + percent + '% complete)';
        bgRect.appendChild(title);
    });

    svgContainer.appendChild(svg);

    // Insert the SVG container before the timeline line
    const timelineLine = container.querySelector('#timelineLine');
    if (timelineLine) {
        container.insertBefore(svgContainer, timelineLine);
    } else {
        container.appendChild(svgContainer);
    }
}

function assignPhaseRows(phases, minDate, totalDays, timelineWidth) {
    // Sort phases by start date
    const sorted = phases.map(phase => {
        const start = parseLocalDate(phase.start);
        const end = parseLocalDate(phase.finish);
        const startPos = (Math.floor((start - minDate) / (1000 * 60 * 60 * 24)) / totalDays) * timelineWidth;
        const endPos = (Math.floor((end - minDate) / (1000 * 60 * 60 * 24)) / totalDays) * timelineWidth;
        return { phase, startPos, endPos };
    }).sort((a, b) => a.startPos - b.startPos);

    // Greedy row assignment: place each phase in the first row where it does not overlap
    const rowEnds = []; // Tracks the rightmost end position in each row
    const result = [];

    sorted.forEach(item => {
        let assignedRow = -1;
        for (let r = 0; r < rowEnds.length; r++) {
            if (item.startPos >= rowEnds[r]) {
                assignedRow = r;
                break;
            }
        }
        if (assignedRow === -1) {
            assignedRow = rowEnds.length;
            rowEnds.push(0);
        }
        rowEnds[assignedRow] = item.endPos;
        result.push({ phase: item.phase, row: assignedRow });
    });

    return result;
}

function darkenColor(hex, amount) {
    // Darken a hex colour by the given amount (0 to 1)
    hex = hex.replace('#', '');
    const r = Math.max(0, Math.floor(parseInt(hex.substring(0, 2), 16) * (1 - amount)));
    const g = Math.max(0, Math.floor(parseInt(hex.substring(2, 4), 16) * (1 - amount)));
    const b = Math.max(0, Math.floor(parseInt(hex.substring(4, 6), 16) * (1 - amount)));
    return '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');
}

function toggleDetailedTimeline() {
    detailedTimelineEnabled = document.getElementById('detailedTimelineToggle')?.checked ?? false;
    if (timelineTasks && timelineTasks.length > 0) {
        updateTimeline(timelineTasks, timelineProjectName);
    }
}

function toggleMinimalTimeline() {
    minimalTimelineEnabled = document.getElementById('minimalTimelineToggle')?.checked ?? false;

    // When minimal is enabled, disable Show Phases and Detailed checkboxes
    const showPhasesToggle = document.getElementById('showPhasesToggle');
    const detailedToggle = document.getElementById('detailedTimelineToggle');

    if (showPhasesToggle) {
        showPhasesToggle.disabled = minimalTimelineEnabled;
        if (minimalTimelineEnabled) showPhasesToggle.checked = false;
    }
    if (detailedToggle) {
        detailedToggle.disabled = minimalTimelineEnabled;
        if (minimalTimelineEnabled) {
            detailedToggle.checked = false;
            detailedTimelineEnabled = false;
        }
    }

    if (timelineTasks && timelineTasks.length > 0) {
        updateTimeline(timelineTasks, timelineProjectName);
    }
}

function toggleTodayMarker() {
    if (timelineTasks && timelineTasks.length > 0) {
        updateTimeline(timelineTasks, timelineProjectName);
    }
}

function renderTodayMarker(container, minDate, maxDate, totalDays, timelineWidth, options) {
    const subtle = options?.subtle ?? false;

    // Remove any existing today marker in this container
    const existing = container.querySelector('.timeline-today-marker');
    if (existing) existing.remove();

    // Get today as a local date (no time component)
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Only show if today falls within the timeline date range
    if (today < minDate || today > maxDate) return;

    const daysFromStart = Math.floor((today - minDate) / (1000 * 60 * 60 * 24));
    const position = (daysFromStart / totalDays) * timelineWidth;

    const marker = document.createElement('div');
    marker.className = 'timeline-today-marker' + (subtle ? ' subtle' : '');
    marker.style.left = position + 'px';

    const label = document.createElement('div');
    label.className = 'timeline-today-label';
    label.textContent = 'Today';
    marker.appendChild(label);

    // Insert the marker into the timeline-line element so it spans the line height
    const timelineLine = container.querySelector('.timeline-line');
    if (timelineLine) {
        timelineLine.appendChild(marker);
    }
}

function renderMinimalTimeline(container, tasks, minDate, maxDate, totalDays, timelineWidth, options) {
    const isReport = options?.isReport ?? false;
    const timelineLineId = isReport ? 'reportTimelineLine' : 'timelineLine';
    const milestonesId = isReport ? 'reportTimelineMilestones' : 'timelineMilestones';

    const timelineLine = document.getElementById(timelineLineId);
    const timelineMilestones = document.getElementById(milestonesId);

    if (!timelineLine || !timelineMilestones) return;

    // Clear existing content
    timelineMilestones.innerHTML = '';
    timelineLine.querySelectorAll('.timeline-progress, .timeline-date-label, .timeline-scale, .timeline-today-marker').forEach(el => el.remove());

    // Remove any existing detailed timeline container
    const existingDetailed = container.querySelector('.detailed-timeline-container');
    if (existingDetailed) existingDetailed.remove();

    // Remove any existing minimal timeline container
    const existingMinimal = container.querySelector('.minimal-timeline-container');
    if (existingMinimal) existingMinimal.remove();

    // Set widths
    timelineLine.style.width = timelineWidth + 'px';
    timelineMilestones.style.width = timelineWidth + 'px';

    // Add the minimal class to the wrapper for compact styling
    container.classList.add('minimal-timeline-mode');

    // Get phase (summary) tasks with valid start and finish dates
    const phases = tasks.filter(t => t.is_summary && t.start && t.finish);

    // Get milestones (0-duration, non-summary) - phases are shown as rectangles above
    const milestones = tasks.filter(t => {
        if (!t.finish) return false;
        return t.duration_days === 0 && !t.is_summary;
    });

    // Calculate bar height as ~1.7% of timeline width
    const barHeight = Math.max(3, Math.round(timelineWidth * 0.017));

    // Assign rows using overlap detection for phases
    const rows = phases.length > 0 ? assignPhaseRows(phases, minDate, totalDays, timelineWidth) : [];
    const numRows = rows.length > 0 ? Math.max(...rows.map(r => r.row)) + 1 : 0;
    const rowHeight = barHeight + 2; // Thin bars with minimal spacing
    const phaseAreaHeight = rowHeight * numRows;

    // Colours
    const blueShades = ['#1565c0', '#1976d2', '#1e88e5', '#2196f3', '#42a5f5', '#64b5f6', '#90caf9'];
    const greenComplete = '#4caf50';

    if (phases.length > 0) {
        // Create SVG container for thin phase bars
        const svgContainer = document.createElement('div');
        svgContainer.className = 'minimal-timeline-container';
        svgContainer.style.width = timelineWidth + 'px';
        svgContainer.style.height = phaseAreaHeight + 'px';
        svgContainer.style.margin = '0 auto 4px auto';

        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', timelineWidth);
        svg.setAttribute('height', phaseAreaHeight);
        svg.setAttribute('class', 'minimal-timeline-svg');

        rows.forEach((phaseInfo, index) => {
            const phase = phaseInfo.phase;
            const row = phaseInfo.row;
            const percent = parseFloat(phase.percent) || 0;
            const isComplete = percent >= 100;

            const phaseStart = parseLocalDate(phase.start);
            const phaseEnd = parseLocalDate(phase.finish);
            const startDays = Math.floor((phaseStart - minDate) / (1000 * 60 * 60 * 24));
            const endDays = Math.floor((phaseEnd - minDate) / (1000 * 60 * 60 * 24));

            const x = Math.max(0, (startDays / totalDays) * timelineWidth);
            const xEnd = Math.min(timelineWidth, (endDays / totalDays) * timelineWidth);
            const width = Math.max(2, xEnd - x);
            const y = row * rowHeight;

            // Colour: green if complete, blue otherwise
            const bgColor = isComplete ? greenComplete : blueShades[index % blueShades.length];

            const rect = document.createElementNS(svgNS, 'rect');
            rect.setAttribute('x', x);
            rect.setAttribute('y', y);
            rect.setAttribute('width', width);
            rect.setAttribute('height', barHeight);
            rect.setAttribute('rx', 2);
            rect.setAttribute('ry', 2);
            rect.setAttribute('fill', bgColor);
            rect.setAttribute('opacity', isComplete ? '0.9' : '0.7');
            rect.setAttribute('class', 'timeline-clickable');
            rect.style.cursor = 'pointer';

            // Add tooltip
            const title = document.createElementNS(svgNS, 'title');
            title.textContent = phase.name + ' (' + percent + '% complete)';
            rect.appendChild(title);

            // Click to open task detail view
            rect.addEventListener('click', () => openMilestoneTaskForm(phase.name));

            svg.appendChild(rect);

            // Draw progress overlay for partially complete phases
            if (percent > 0 && percent < 100) {
                const progressWidth = (percent / 100) * width;
                const darkerColor = darkenColor(bgColor, 0.35);
                const progressRect = document.createElementNS(svgNS, 'rect');
                progressRect.setAttribute('x', x);
                progressRect.setAttribute('y', y);
                progressRect.setAttribute('width', progressWidth);
                progressRect.setAttribute('height', barHeight);
                progressRect.setAttribute('rx', 2);
                progressRect.setAttribute('ry', 2);
                progressRect.setAttribute('fill', darkerColor);
                progressRect.setAttribute('opacity', '0.9');
                progressRect.setAttribute('class', 'timeline-clickable');
                progressRect.style.cursor = 'pointer';
                progressRect.addEventListener('click', () => openMilestoneTaskForm(phase.name));
                svg.appendChild(progressRect);
            }

            // Add phase name text inside the rectangle (left-aligned, white, small font)
            if (width > 20) { // Only show text if rectangle is wide enough
                const fontSize = Math.min(10, Math.max(8, barHeight - 2)); // Slightly smaller font for minimal view
                const clipId = 'minimal-phase-clip-' + index;
                const clipPath = document.createElementNS(svgNS, 'clipPath');
                clipPath.setAttribute('id', clipId);
                const clipRect = document.createElementNS(svgNS, 'rect');
                clipRect.setAttribute('x', x + 2);
                clipRect.setAttribute('y', y);
                clipRect.setAttribute('width', Math.max(0, width - 4));
                clipRect.setAttribute('height', barHeight);
                clipPath.appendChild(clipRect);
                svg.appendChild(clipPath);

                const text = document.createElementNS(svgNS, 'text');
                text.setAttribute('x', x + 4); // Left-aligned with small padding
                text.setAttribute('y', y + barHeight / 2);
                text.setAttribute('dominant-baseline', 'central');
                text.setAttribute('font-size', fontSize + 'px');
                text.setAttribute('fill', '#ffffff'); // White text
                text.setAttribute('font-weight', '500');
                text.setAttribute('clip-path', 'url(#' + clipId + ')');
                text.textContent = isComplete ? '✓ ' + phase.name : phase.name;
                text.style.cursor = 'pointer';
                text.addEventListener('click', () => openMilestoneTaskForm(phase.name));
                svg.appendChild(text);
            }
        });

        svgContainer.appendChild(svg);

        // Insert before the timeline line
        if (timelineLine) {
            container.insertBefore(svgContainer, timelineLine);
        } else {
            container.appendChild(svgContainer);
        }
    }

    // Show the main timeline line as a thin backbone in minimal mode
    timelineLine.style.display = '';
    timelineLine.style.height = '2px';
    timelineLine.style.background = '#ccc';

    // Add minimal milestone markers (small dots, no labels)
    milestones.forEach((task) => {
        const milestoneDate = parseLocalDate(task.finish);
        const daysFromStart = Math.floor((milestoneDate - minDate) / (1000 * 60 * 60 * 24));
        const position = (daysFromStart / totalDays) * timelineWidth;

        const percent = parseFloat(task.percent) || 0;
        const isComplete = percent >= 100;

        const milestoneDiv = document.createElement('div');
        milestoneDiv.className = 'timeline-milestone minimal-milestone';
        milestoneDiv.style.left = position + 'px';

        const marker = document.createElement('div');
        marker.className = 'minimal-milestone-marker';
        marker.style.background = isComplete ? '#28a745' : '#1976d2';

        // Add tooltip
        marker.title = task.name + ' (' + task.finish + ')';

        // Click to open task detail view
        marker.style.cursor = 'pointer';
        marker.addEventListener('click', () => openMilestoneTaskForm(task.name));

        milestoneDiv.appendChild(marker);

        // Phase names are now displayed inside the phase rectangles above, not as milestone labels
        timelineMilestones.appendChild(milestoneDiv);
    });

    // Add date scale in small font
    addMinimalDateScale(container, minDate, maxDate, totalDays, timelineWidth);

    // Always show a subtle today marker on minimal timelines
    renderTodayMarker(container, minDate, maxDate, totalDays, timelineWidth, { subtle: true });
}

function addMinimalDateScale(container, minDate, maxDate, totalDays, timelineWidth) {
    // Remove existing minimal date scale
    const existing = container.querySelector('.minimal-date-scale');
    if (existing) existing.remove();

    const scaleDiv = document.createElement('div');
    scaleDiv.className = 'minimal-date-scale';
    scaleDiv.style.width = timelineWidth + 'px';

    // Determine scale intervals (same logic as addTimelineDateScale but simplified)
    let formatFunc;
    let markers = [];

    if (totalDays <= 60) {
        const interval = Math.max(2, Math.ceil(totalDays / 7));
        formatFunc = (date) => {
            const day = date.getDate();
            const month = date.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
            return `${day} ${month}`;
        };
        const currentDate = new Date(minDate);
        while (currentDate <= maxDate) {
            const daysSinceStart = Math.floor((currentDate - minDate) / (1000 * 60 * 60 * 24));
            if (daysSinceStart % interval === 0) {
                const position = (daysSinceStart / totalDays) * timelineWidth;
                markers.push({ position, label: formatFunc(new Date(currentDate)) });
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }
    } else if (totalDays <= 365) {
        const interval = Math.max(1, Math.floor(totalDays / 70));
        formatFunc = (date) => {
            const day = date.getDate();
            const month = date.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
            return `${day} ${month}`;
        };
        const currentDate = new Date(minDate);
        while (currentDate.getDay() !== 1) {
            currentDate.setDate(currentDate.getDate() + 1);
        }
        let weekCount = 0;
        while (currentDate <= maxDate) {
            if (weekCount % interval === 0) {
                const daysSinceStart = Math.floor((currentDate - minDate) / (1000 * 60 * 60 * 24));
                const position = (daysSinceStart / totalDays) * timelineWidth;
                markers.push({ position, label: formatFunc(new Date(currentDate)) });
            }
            currentDate.setDate(currentDate.getDate() + 7);
            weekCount++;
        }
    } else if (totalDays <= 730) {
        formatFunc = (date) => {
            const month = date.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
            const year = date.getFullYear().toString().slice(-2);
            return `${month} '${year}`;
        };
        const currentDate = new Date(minDate);
        currentDate.setMonth(currentDate.getMonth() + 1);
        currentDate.setDate(1);
        while (currentDate <= maxDate) {
            const daysSinceStart = Math.floor((currentDate - minDate) / (1000 * 60 * 60 * 24));
            const position = (daysSinceStart / totalDays) * timelineWidth;
            markers.push({ position, label: formatFunc(new Date(currentDate)) });
            currentDate.setMonth(currentDate.getMonth() + 1);
        }
    } else {
        formatFunc = (date) => date.getFullYear().toString();
        const currentDate = new Date(minDate);
        currentDate.setFullYear(currentDate.getFullYear() + 1);
        currentDate.setMonth(0);
        currentDate.setDate(1);
        while (currentDate <= maxDate) {
            const daysSinceStart = Math.floor((currentDate - minDate) / (1000 * 60 * 60 * 24));
            const position = (daysSinceStart / totalDays) * timelineWidth;
            markers.push({ position, label: formatFunc(new Date(currentDate)) });
            currentDate.setFullYear(currentDate.getFullYear() + 1);
        }
    }

    // Estimate label width in pixels (~6px per character at 0.65em font)
    const charWidth = 6;
    const labelPadding = 8; // minimum gap between labels

    const startText = minDate.toISOString().split('T')[0];
    const endText = maxDate.toISOString().split('T')[0];

    // Start label occupies [0, startLabelWidth + padding] (left-aligned)
    const startLabelWidth = startText.length * charWidth;
    const startLabelEnd = startLabelWidth + labelPadding;

    // End label occupies [timelineWidth - endLabelWidth - padding, timelineWidth] (right-aligned)
    const endLabelWidth = endText.length * charWidth;
    const endLabelStart = timelineWidth - endLabelWidth - labelPadding;

    // Filter intermediate markers that would overlap with start/end labels or each other
    // Intermediate labels are center-aligned (transform: translateX(-50%))
    const placedIntervals = [];

    const filteredMarkers = markers.filter(marker => {
        const halfWidth = (marker.label.length * charWidth) / 2;
        const markerLeft = marker.position - halfWidth;
        const markerRight = marker.position + halfWidth;

        // Check overlap with start label
        if (markerLeft < startLabelEnd) return false;

        // Check overlap with end label
        if (markerRight > endLabelStart) return false;

        // Check overlap with previously placed intermediate markers
        for (const interval of placedIntervals) {
            if (markerLeft < interval.right + labelPadding && markerRight > interval.left - labelPadding) {
                return false;
            }
        }

        placedIntervals.push({ left: markerLeft, right: markerRight });
        return true;
    });

    // Add start date label (left-aligned)
    const startLabel = document.createElement('span');
    startLabel.className = 'minimal-date-label';
    startLabel.style.left = '0';
    startLabel.textContent = startText;
    scaleDiv.appendChild(startLabel);

    // Add filtered intermediate markers
    filteredMarkers.forEach(marker => {
        const markerSpan = document.createElement('span');
        markerSpan.className = 'minimal-date-label minimal-date-tick';
        markerSpan.style.left = marker.position + 'px';
        markerSpan.textContent = marker.label;
        scaleDiv.appendChild(markerSpan);
    });

    // Add end date label (right-aligned)
    const endLabel = document.createElement('span');
    endLabel.className = 'minimal-date-label';
    endLabel.style.right = '0';
    endLabel.style.left = 'auto';
    endLabel.textContent = endText;
    scaleDiv.appendChild(endLabel);

    // Insert after the milestones container
    const milestonesEl = container.querySelector('.timeline-milestones');
    if (milestonesEl && milestonesEl.nextSibling) {
        container.insertBefore(scaleDiv, milestonesEl.nextSibling);
    } else {
        container.appendChild(scaleDiv);
    }
}

function addTimelineDateScale(timelineLine, minDate, maxDate, totalDays, timelineWidth) {
    // Determine appropriate scale based on timeline duration
    let scale, interval, formatFunc;

    if (totalDays <= 60) {
        // Show days for short projects (up to 2 months)
        scale = 'days';
        // Calculate interval to ensure minimum spacing (aim for 5-8 markers max)
        interval = Math.max(2, Math.ceil(totalDays / 7)); // Show ~5-7 markers
        formatFunc = (date) => {
            const day = date.getDate();
            const month = date.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
            return `${day} ${month}`;
        };
    } else if (totalDays <= 365) {
        // Show weeks for medium projects (2 months to 1 year)
        scale = 'weeks';
        interval = Math.max(1, Math.floor(totalDays / 70)); // Show ~10-12 markers
        formatFunc = (date) => {
            const day = date.getDate();
            const month = date.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
            return `${day} ${month}`;
        };
    } else if (totalDays <= 730) {
        // Show months for longer projects (1-2 years)
        scale = 'months';
        interval = 1;
        formatFunc = (date) => {
            const month = date.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
            const year = date.getFullYear().toString().slice(-2);
            return `${month} '${year}`;
        };
    } else {
        // Show years for very long projects (>2 years)
        scale = 'years';
        interval = 1;
        formatFunc = (date) => {
            return date.getFullYear().toString();
        };
    }

    // Create scale container
    const scaleContainer = document.createElement('div');
    scaleContainer.className = 'timeline-scale';

    // Generate markers
    const currentDate = new Date(minDate);
    const markers = [];

    if (scale === 'days') {
        while (currentDate <= maxDate) {
            const daysSinceStart = Math.floor((currentDate - minDate) / (1000 * 60 * 60 * 24));
            if (daysSinceStart % interval === 0) {
                const position = (daysSinceStart / totalDays) * timelineWidth;
                markers.push({ position, label: formatFunc(new Date(currentDate)) });
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }
    } else if (scale === 'weeks') {
        // Start from first Monday after minDate
        while (currentDate.getDay() !== 1) {
            currentDate.setDate(currentDate.getDate() + 1);
        }
        let weekCount = 0;
        while (currentDate <= maxDate) {
            if (weekCount % interval === 0) {
                const daysSinceStart = Math.floor((currentDate - minDate) / (1000 * 60 * 60 * 24));
                const position = (daysSinceStart / totalDays) * timelineWidth;
                markers.push({ position, label: formatFunc(new Date(currentDate)) });
            }
            currentDate.setDate(currentDate.getDate() + 7);
            weekCount++;
        }
    } else if (scale === 'months') {
        // Start from first day of next month
        currentDate.setMonth(currentDate.getMonth() + 1);
        currentDate.setDate(1);
        while (currentDate <= maxDate) {
            const daysSinceStart = Math.floor((currentDate - minDate) / (1000 * 60 * 60 * 24));
            const position = (daysSinceStart / totalDays) * timelineWidth;
            markers.push({ position, label: formatFunc(new Date(currentDate)) });
            currentDate.setMonth(currentDate.getMonth() + interval);
        }
    } else if (scale === 'years') {
        // Start from January 1st of next year
        currentDate.setFullYear(currentDate.getFullYear() + 1);
        currentDate.setMonth(0);
        currentDate.setDate(1);
        while (currentDate <= maxDate) {
            const daysSinceStart = Math.floor((currentDate - minDate) / (1000 * 60 * 60 * 24));
            const position = (daysSinceStart / totalDays) * timelineWidth;
            markers.push({ position, label: formatFunc(new Date(currentDate)) });
            currentDate.setFullYear(currentDate.getFullYear() + interval);
        }
    }

    // Create marker elements
    markers.forEach(marker => {
        const markerDiv = document.createElement('div');
        markerDiv.className = 'timeline-scale-marker';
        markerDiv.style.left = marker.position + 'px';

        const tick = document.createElement('div');
        tick.className = 'timeline-scale-tick';
        markerDiv.appendChild(tick);

        const label = document.createElement('div');
        label.className = 'timeline-scale-label';
        label.textContent = marker.label;
        markerDiv.appendChild(label);

        scaleContainer.appendChild(markerDiv);
    });

    timelineLine.appendChild(scaleContainer);
}

function updateTimeline(tasks, projectName) {
    try {
        // Store tasks and project name for re-rendering on resize
        timelineTasks = tasks;
        timelineProjectName = projectName || '';

        // If there is exactly one task at the highest level, filter it out
        // as it represents the project container and clutters the timeline.
        if (tasks.length > 0) {
            const minLevel = Math.min(...tasks.map(t => t.level));
            const topLevelTasks = tasks.filter(t => t.level === minLevel);
            if (topLevelTasks.length === 1) {
                tasks = tasks.filter(t => t.level !== minLevel);
            }
        }

        // Show timeline content, hide placeholder
        const placeholder = document.querySelector('#timeline-view .placeholder-view');
        const content = document.querySelector('#timeline-view .timeline-content');

        if (placeholder && content) {
            placeholder.style.display = 'none';
            content.style.display = 'block';
        }

        // Update timeline title with project name
        const titleElement = document.getElementById('timelineTitle');
        if (titleElement) {
            const displayName = projectName || 'Project';
            titleElement.textContent = `${displayName} Timeline`;
        }

        // Calculate total timeline width - scale to available screen width
        const timelineWrapper = document.querySelector('#timeline-view .timeline-line-wrapper');

        // Skip rendering if the container is hidden (e.g. tab not visible).
        // The timeline will be re-rendered when the tab becomes visible
        // via switchOutputTab().
        if (timelineWrapper && timelineWrapper.offsetWidth === 0) {
            return;
        }

        const isMinimal = document.getElementById('minimalTimelineToggle')?.checked ?? false;

        // Restore normal mode styling when switching away from minimal
        if (!isMinimal && timelineWrapper) {
            timelineWrapper.classList.remove('minimal-timeline-mode');
            const timelineLineEl = document.getElementById('timelineLine');
            if (timelineLineEl) {
                timelineLineEl.style.display = '';
                timelineLineEl.style.height = '';
                timelineLineEl.style.background = '';
            }
            const existingMinimal = timelineWrapper.querySelector('.minimal-timeline-container');
            if (existingMinimal) existingMinimal.remove();
            const existingMinimalScale = timelineWrapper.querySelector('.minimal-date-scale');
            if (existingMinimalScale) existingMinimalScale.remove();
        }

        // For minimal mode, compute dates from all phases and milestones
        if (isMinimal) {
            const allTasks = tasks.filter(t => (t.start && t.finish) || (t.finish && t.duration_days === 0));
            if (allTasks.length === 0) return;

            const allDates = [];
            allTasks.forEach(t => {
                if (t.start) allDates.push(parseLocalDate(t.start));
                if (t.finish) allDates.push(parseLocalDate(t.finish));
            });
            const minDate = new Date(Math.min(...allDates));
            const maxDate = new Date(Math.max(...allDates));
            minDate.setDate(minDate.getDate() - 7);
            maxDate.setDate(maxDate.getDate() + 7);

            const availableWidth = timelineWrapper ? timelineWrapper.offsetWidth - 100 : 1200;
            const timelineWidth = Math.max(800, availableWidth);
            const totalDays = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24)) + 1;

            renderMinimalTimeline(timelineWrapper, tasks, minDate, maxDate, totalDays, timelineWidth, { isReport: false });
            return;
        }

        // Get milestones based on toggle setting
        const showPhases = document.getElementById('showPhasesToggle')?.checked ?? false;
        const isDetailed = document.getElementById('detailedTimelineToggle')?.checked ?? false;
        const milestones = tasks.filter(t => {
            if (!t.finish) return false;
            // Always include 0-duration milestones
            if (t.duration_days === 0 && !t.is_summary) return true;
            // Include summary tasks (phases) only if toggle is on
            if (t.is_summary && showPhases) return true;
            return false;
        });

        // When detailed mode is on, also collect phases for date range calculation
        const detailedPhases = isDetailed ? tasks.filter(t => t.is_summary && t.start && t.finish) : [];

        if (milestones.length === 0 && detailedPhases.length === 0) {
            return;
        }

        // Find min and max dates (include phase start/finish when detailed view is on)
        const allDates = milestones.map(t => parseLocalDate(t.finish));
        detailedPhases.forEach(p => {
            allDates.push(parseLocalDate(p.start));
            allDates.push(parseLocalDate(p.finish));
        });
        const minDate = new Date(Math.min(...allDates));
        const maxDate = new Date(Math.max(...allDates));

        // Add padding
        minDate.setDate(minDate.getDate() - 7);
        maxDate.setDate(maxDate.getDate() + 7);

        const availableWidth = timelineWrapper ? timelineWrapper.offsetWidth - 100 : 1200; // Subtract padding
        const timelineWidth = Math.max(800, availableWidth); // Minimum 800px

        const totalDays = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24)) + 1;

        // Get timeline elements
        const timelineLine = document.getElementById('timelineLine');
        const timelineMilestones = document.getElementById('timelineMilestones');

        if (!timelineLine || !timelineMilestones) return;

        // Clear existing milestones and progress bar
        timelineMilestones.innerHTML = '';

        // Remove any existing timeline elements to prevent overlap
        const existingProgress = timelineLine.querySelector('.timeline-progress');
        if (existingProgress) {
            existingProgress.remove();
        }

        // Remove old date labels (start/end)
        const oldDateLabels = timelineLine.querySelectorAll('.timeline-date-label');
        oldDateLabels.forEach(label => label.remove());

        // Remove old date scale
        const oldScale = timelineLine.querySelector('.timeline-scale');
        if (oldScale) {
            oldScale.remove();
        }

        // Remove old today marker
        const oldTodayMarker = timelineLine.querySelector('.timeline-today-marker');
        if (oldTodayMarker) {
            oldTodayMarker.remove();
        }

        // Set timeline line and milestones container width (both must match for alignment)
        timelineLine.style.width = timelineWidth + 'px';
        timelineMilestones.style.width = timelineWidth + 'px';

        // Calculate overall project completion percentage
        let totalTasks = 0;
        let completedWeight = 0;

        tasks.forEach(task => {
            if (!task.is_summary && task.duration_days > 0) {
                totalTasks++;
                const percent = parseFloat(task.percent) || 0;
                completedWeight += percent;
            }
        });

        const overallCompletion = totalTasks > 0 ? (completedWeight / totalTasks) : 0;

        console.log('Timeline progress calculation:', {
            totalTasks,
            completedWeight,
            overallCompletion
        });

        // Add progress bar to timeline (always show, even at 0% for debugging)
        const progressBar = document.createElement('div');
        progressBar.className = 'timeline-progress';
        progressBar.style.width = overallCompletion + '%';
        timelineLine.appendChild(progressBar);
        console.log('Progress bar added with width:', overallCompletion + '%');

        // Add start and end date labels
        const startDateLabel = document.createElement('div');
        startDateLabel.className = 'timeline-date-label timeline-start-date';
        startDateLabel.textContent = minDate.toISOString().split('T')[0];
        timelineLine.appendChild(startDateLabel);

        const endDateLabel = document.createElement('div');
        endDateLabel.className = 'timeline-date-label timeline-end-date';
        endDateLabel.textContent = maxDate.toISOString().split('T')[0];
        timelineLine.appendChild(endDateLabel);

        // Add date scale markers below the timeline
        addTimelineDateScale(timelineLine, minDate, maxDate, totalDays, timelineWidth);

        // Render detailed phase blocks above the timeline line (if enabled)
        if (timelineWrapper) {
            renderDetailedPhaseBlocks(timelineWrapper, tasks, minDate, maxDate, totalDays, timelineWidth);
        }

        // Track milestone positions for overlap prevention (separate above and below)
        const positionsAbove = [];
        const positionsBelow = [];

        // Create milestones
        milestones.forEach((task, index) => {
            const milestoneDate = parseLocalDate(task.finish);
            const daysFromStart = Math.floor((milestoneDate - minDate) / (1000 * 60 * 60 * 24));
            const position = (daysFromStart / totalDays) * timelineWidth;

            // When detailed view is on, phase labels go below to avoid overlapping SVG blocks
            const placeBelow = isDetailed;
            const trackingArray = placeBelow ? positionsBelow : positionsAbove;

            // Check for overlap and adjust label position
            let labelOffset = 0;
            const minSpacing = 170; // Slightly more than label width (150px min-width + 20px buffer)
            let foundLevel = false;
            const maxLevels = 5; // Support up to 5 vertical levels

            // Try to find a vertical level without overlap
            for (let level = 0; level < maxLevels && !foundLevel; level++) {
                labelOffset = placeBelow ? level * 50 : level * -50;
                foundLevel = true;

                // Check if this level has overlap with any previous milestone at same level
                for (let i = 0; i < trackingArray.length; i++) {
                    const prevPos = trackingArray[i];
                    if (prevPos.offset === labelOffset && Math.abs(position - prevPos.pos) < minSpacing) {
                        foundLevel = false;
                        break;
                    }
                }
            }

            // If no level found (too cluttered), skip this milestone to avoid clutter
            if (!foundLevel) {
                return; // Skip this milestone in forEach
            }

            trackingArray.push({ pos: position, offset: labelOffset });

            // Create milestone container
            const milestoneDiv = document.createElement('div');
            milestoneDiv.className = 'timeline-milestone';
            milestoneDiv.style.left = position + 'px';
            milestoneDiv.style.cursor = 'pointer';

            // Make milestone clickable to open task form
            milestoneDiv.addEventListener('click', () => {
                openMilestoneTaskForm(task.name);
            });

            // Create connecting line if label is offset
            if (labelOffset !== 0) {
                const connector = document.createElement('div');
                connector.className = 'timeline-connector';
                const lineHeight = Math.abs(labelOffset);
                connector.style.height = lineHeight + 'px';
                if (placeBelow) {
                    connector.style.top = '10px'; // Start from marker center, extend downward
                } else {
                    connector.style.bottom = '10px'; // Start from diamond center, extend upward
                }
                milestoneDiv.appendChild(connector);
            }

            // Create milestone marker on the line (always at same position)
            // Use circle for milestones, green with checkmark if 100% complete
            const marker = document.createElement('div');
            const percent = parseFloat(task.percent) || 0;
            const isComplete = percent >= 100;

            if (task.is_summary) {
                // Summary tasks still use diamond shape
                marker.className = 'timeline-diamond phase-diamond';
            } else {
                // Regular milestones use circle with SVG
                marker.className = 'timeline-circle';
                marker.innerHTML = isComplete
                    ? `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="10" cy="10" r="9" fill="#28a745" stroke="#fff" stroke-width="1"/>
                        <path d="M6 10 L9 13 L14 7" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                       </svg>`
                    : `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="10" cy="10" r="9" fill="#333" stroke="#fff" stroke-width="1"/>
                       </svg>`;
            }
            milestoneDiv.appendChild(marker);

            // Create label (above or below the line depending on placeBelow)
            const label = document.createElement('div');
            label.className = 'timeline-milestone-label';

            if (placeBelow) {
                // Position label below the timeline line
                label.style.bottom = 'auto';
                label.style.top = (75 + labelOffset) + 'px';
            } else if (labelOffset !== 0) {
                // Apply vertical offset for labels above the line
                label.style.bottom = (20 - labelOffset) + 'px';
            }

            const nameDiv = document.createElement('div');
            nameDiv.className = 'milestone-name';
            nameDiv.textContent = task.name;
            label.appendChild(nameDiv);

            const dateDiv = document.createElement('div');
            dateDiv.className = 'milestone-date';
            dateDiv.textContent = task.finish;
            label.appendChild(dateDiv);

            milestoneDiv.appendChild(label);

            timelineMilestones.appendChild(milestoneDiv);
        });

        // Render today marker if the toggle is checked
        const showTodayMarker = document.getElementById('todayMarkerToggle')?.checked ?? false;
        if (showTodayMarker && timelineWrapper) {
            renderTodayMarker(timelineWrapper, minDate, maxDate, totalDays, timelineWidth, { subtle: false });
        } else if (timelineWrapper) {
            // Remove existing today marker if toggle is off
            const existingMarker = timelineWrapper.querySelector('.timeline-today-marker');
            if (existingMarker) existingMarker.remove();
        }

    } catch (error) {
        console.error('Error updating timeline:', error);
    }
}

// Gantt chart state
let ganttTasks = [];
let ganttScale = 'days';
let ganttMinDate = null;
let ganttMaxDate = null;
let ganttPixelsPerDay = 30;
let collapsedSummaryTasks = new Set();

// Helper function to parse date strings consistently as local dates
// This avoids timezone issues where YYYY-MM-DD is parsed as UTC
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
 * Convert a task's depends[] + lag_lead{} into a display string like "3FS, 5FS+2d".
 * All dependencies are Finish-to-Start (FS) since that is the only type currently supported.
 */
function formatPredecessors(task, nameToId) {
    if (!task.depends || task.depends.length === 0) return '';
    const lagLead = task.lag_lead || {};
    const parts = [];
    for (const depName of task.depends) {
        const depId = nameToId[depName.toLowerCase()];
        if (depId === undefined) continue;  // unknown dependency — skip
        let entry = depId + 'FS';
        if (lagLead[depName]) {
            // lagLead values look like "+2d" or "-1w"
            entry += lagLead[depName];
        }
        parts.push(entry);
    }
    return parts.join(', ');
}

/**
 * Parse a predecessors display string (e.g. "3FS, 5FS+2d") back into
 * { depends: [name1, name2], lag_lead: { name1: '+2d' } }.
 * Returns null if parsing fails.
 */
function parsePredecessorsString(str, idToName) {
    if (!str || !str.trim()) return { depends: [], lag_lead: {} };
    const depends = [];
    const lagLead = {};
    const specs = str.split(',');
    for (let spec of specs) {
        spec = spec.trim();
        if (!spec) continue;
        // Pattern: ID + "FS" + optional lag like "+2d" or "-1w"
        const m = spec.match(/^(\d+)\s*FS\s*([+-]\d+[dwmy])?$/i);
        if (!m) return null;  // invalid format
        const id = parseInt(m[1], 10);
        const name = idToName[id];
        if (!name) return null;  // unknown ID
        depends.push(name);
        if (m[2]) {
            lagLead[name] = m[2];
        }
    }
    return { depends, lag_lead: lagLead };
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
            ganttPixelsPerDay = 60;
            break;
        case 'weeks':
            ganttPixelsPerDay = 25;
            break;
        case 'months':
            ganttPixelsPerDay = 10;
            break;
        case 'quarters':
            ganttPixelsPerDay = 5;
            break;
        case 'years':
            ganttPixelsPerDay = 2;
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

    // Auto-scroll to current date (only in days view)
    if (ganttScale === 'days') {
        scrollGanttToToday();
    }
}

function scrollGanttToToday() {
    // Scroll the chart side to show today's date
    const chartSide = document.querySelector('.gantt-chart-side');
    const todayColumn = document.querySelector('.gantt-today');

    if (!chartSide || !todayColumn) {
        return;
    }

    // Calculate the scroll position to show today's date
    // Get the offset of the today column relative to its parent
    const todayOffset = todayColumn.offsetLeft;

    // Scroll so that today's column appears near the left edge
    // Subtract a bit to give some context (show a day or two before)
    const scrollPosition = todayOffset - (ganttPixelsPerDay * 2);

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
    // Calculate total days by iterating from min to max date
    // This ensures we have exactly one header per day in the range
    let currentDate = new Date(ganttMinDate);
    const endDate = new Date(ganttMaxDate);
    const today = new Date();

    // Reset times to midnight for accurate day counting
    currentDate.setHours(0, 0, 0, 0);
    endDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    while (currentDate <= endDate) {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'gantt-month';
        dayDiv.style.width = ganttPixelsPerDay + 'px';
        dayDiv.textContent = currentDate.getDate();
        dayDiv.title = currentDate.toLocaleDateString();

        // Highlight current date with light green background
        if (currentDate.getTime() === today.getTime()) {
            dayDiv.classList.add('gantt-today');
        }

        container.appendChild(dayDiv);

        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
    }
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

        // Done checkbox cell (skip for summary tasks)
        const doneCell = document.createElement('td');
        doneCell.classList.add('gantt-done-cell');
        if (!task.is_summary) {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'round-checkbox';
            checkbox.checked = (parseFloat(task.percent) || 0) >= 100;
            checkbox.title = checkbox.checked ? 'Mark incomplete' : 'Mark complete';
            checkbox.addEventListener('change', (e) => {
                e.stopPropagation();
                const newPercent = checkbox.checked ? '100%' : '0%';
                task.percent = newPercent;
                syncGanttPercentToEditor(task, index);
            });
            doneCell.appendChild(checkbox);
        }
        infoRow.appendChild(doneCell);

        // ID cell (not editable)
        const idCell = document.createElement('td');
        idCell.textContent = task.id;
        infoRow.appendChild(idCell);

        // Task Name cell (editable)
        const nameCell = document.createElement('td');
        nameCell.classList.add('editable');
        nameCell.dataset.field = 'name';
        const indent = '  '.repeat(task.level);

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
            nameCell.style.fontFamily = "'Courier New', monospace";
            nameCell.style.whiteSpace = 'pre';
            nameCell.appendChild(document.createTextNode(indent));
            nameCell.appendChild(triangle);
            nameCell.appendChild(document.createTextNode(' ' + task.name));
        } else {
            nameCell.textContent = indent + task.name;
            nameCell.style.fontFamily = "'Courier New', monospace";
            nameCell.style.whiteSpace = 'pre';
        }

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

        // Resources cell (editable)
        const resourcesCell = document.createElement('td');
        resourcesCell.classList.add('editable');
        resourcesCell.dataset.field = 'resources';
        resourcesCell.textContent = task.resources || '-';
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
            const ragDot = document.createElement('span');
            ragDot.className = 'gantt-rag-dot rag-' + task.rag.toLowerCase();
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

        // Bucket cell (editable)
        const bucketCell = document.createElement('td');
        bucketCell.classList.add('editable');
        bucketCell.dataset.field = 'bucket';
        bucketCell.textContent = task.bucket || '-';
        bucketCell.addEventListener('dblclick', () => makeEditable(bucketCell, task, index));
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
                const leftPos = daysFromStart * ganttPixelsPerDay + (ganttPixelsPerDay / 2) - 9;
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
                // Calculate task duration in days by counting (inclusive of both start and end day)
                let taskDuration = 1; // Start day counts as 1
                tempDate = new Date(taskStart);
                while (tempDate < taskFinish) {
                    tempDate.setDate(tempDate.getDate() + 1);
                    taskDuration++;
                }

                const bar = document.createElement('div');
                bar.className = task.is_summary ? 'gantt-bar gantt-phase-bar' : 'gantt-bar gantt-task-bar';
                // Apply RAG colouring to non-summary task bars
                if (!task.is_summary && task.rag && task.rag.toLowerCase() !== 'green') {
                    bar.classList.add('gantt-bar-' + task.rag.toLowerCase());
                }
                const leftPos = daysFromStart * ganttPixelsPerDay;
                const barWidth = taskDuration * ganttPixelsPerDay;
                bar.style.left = leftPos + 'px';
                bar.style.width = barWidth + 'px';
                bar.title = `${task.name}\n${task.start} to ${task.finish}\nDuration: ${taskDuration} days`;
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
        }

        ganttInfoBody.appendChild(infoRow);
        ganttBody.appendChild(barRow);
    });

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

    // Reset times to midnight
    currentDate.setHours(0, 0, 0, 0);
    endDate.setHours(0, 0, 0, 0);

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

        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
        dayIndex++;
    }
}

function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function makeEditable(cell, task, taskIndex) {
    if (cell.classList.contains('editing')) return;
    if (task.is_summary && cell.dataset.field === 'resources') return;  // Don't edit resources for summary tasks

    const field = cell.dataset.field;

    // Get current value based on field type
    let currentValue;
    if (field === 'duration') {
        currentValue = task.duration_days ? `${task.duration_days}` : '';
    } else if (field === 'start') {
        currentValue = task.start || '';
    } else if (field === 'finish') {
        currentValue = task.finish || '';
    } else if (field === 'percent') {
        currentValue = task.percent ? String(task.percent).replace('%', '') : '';
    } else if (field === 'predecessors') {
        const _nameToId = buildTaskNameToIdMap(ganttTasks);
        currentValue = formatPredecessors(task, _nameToId);
    } else {
        currentValue = task[field] || '';
    }

    cell.classList.add('editing');
    const input = document.createElement('input');

    // Use date picker for date fields
    if (field === 'start' || field === 'finish') {
        input.type = 'date';
        input.value = currentValue;
    } else {
        input.type = 'text';
        input.value = currentValue;
    }

    input.style.width = '100%';

    const originalContent = cell.textContent;
    cell.textContent = '';
    cell.appendChild(input);
    input.focus();

    // Select text only for text inputs (date inputs don't support select())
    if (input.type === 'text') {
        input.select();
    }

    const saveEdit = () => {
        const newValue = input.value.trim();
        cell.classList.remove('editing');

        if (newValue !== currentValue) {
            // Handle different field types
            if (field === 'duration') {
                // Parse duration (remove 'd' suffix if present)
                const durationValue = parseInt(newValue.replace(/d$/i, ''));
                if (!isNaN(durationValue) && durationValue > 0) {
                    task.duration_days = durationValue;
                    ganttTasks[taskIndex].duration_days = durationValue;
                    syncGanttDurationToEditor(task, taskIndex);
                    cell.textContent = `${durationValue}d`;
                } else {
                    cell.textContent = originalContent;
                }
            } else if (field === 'start') {
                // Validate date format (YYYY-MM-DD)
                if (/^\d{4}-\d{2}-\d{2}$/.test(newValue)) {
                    task.start = newValue;
                    ganttTasks[taskIndex].start = newValue;
                    syncGanttStartDateToEditor(task, taskIndex);
                    cell.textContent = newValue;
                } else {
                    cell.textContent = originalContent;
                }
            } else if (field === 'finish') {
                // Validate date format (YYYY-MM-DD)
                if (/^\d{4}-\d{2}-\d{2}$/.test(newValue)) {
                    task.finish = newValue;
                    ganttTasks[taskIndex].finish = newValue;
                    syncGanttFinishDateToEditor(task, taskIndex);
                    cell.textContent = newValue;
                } else {
                    cell.textContent = originalContent;
                }
            } else if (field === 'percent') {
                // Parse percent (remove '%' suffix if present)
                const percentValue = parseInt(newValue.replace(/%$/i, ''));
                if (!isNaN(percentValue) && percentValue >= 0 && percentValue <= 100) {
                    task.percent = `${percentValue}%`;
                    ganttTasks[taskIndex].percent = `${percentValue}%`;
                    syncGanttPercentToEditor(task, taskIndex);
                    cell.textContent = `${percentValue}%`;
                } else {
                    cell.textContent = originalContent;
                }
            } else if (field === 'predecessors') {
                // Parse the predecessors string back to depends / lag_lead
                const _idToName = buildIdToTaskNameMap(ganttTasks);
                const parsed = parsePredecessorsString(newValue, _idToName);
                if (parsed === null) {
                    alert('Invalid predecessors format. Use e.g. "3FS" or "3FS+2d, 5FS".');
                    cell.textContent = originalContent;
                } else {
                    // Check for loops before accepting
                    const _nameToId2 = buildTaskNameToIdMap(ganttTasks);
                    const proposedIds = parsed.depends.map(n => _nameToId2[n.toLowerCase()]).filter(id => id !== undefined);
                    if (wouldCreateLoop(task.id, proposedIds, ganttTasks)) {
                        alert('Cannot set these predecessors — it would create a circular dependency.');
                        cell.textContent = originalContent;
                    } else {
                        task.depends = parsed.depends;
                        task.lag_lead = parsed.lag_lead;
                        ganttTasks[taskIndex].depends = parsed.depends;
                        ganttTasks[taskIndex].lag_lead = parsed.lag_lead;
                        syncGanttPredecessorsToEditor(task, taskIndex);
                        const _nameToId3 = buildTaskNameToIdMap(ganttTasks);
                        cell.textContent = formatPredecessors(task, _nameToId3) || '-';
                    }
                }
            } else {
                // Original fields: name, resources, comment
                // For name field, save the old name before updating
                const oldName = field === 'name' ? task.name : null;

                task[field] = newValue;
                ganttTasks[taskIndex][field] = newValue;
                syncGanttEditToEditor(task, taskIndex, field, newValue, oldName);

                // Update cell display
                if (field === 'name') {
                    renderGanttRows();
                    return;
                } else {
                    cell.textContent = newValue || '-';
                }
            }
        } else {
            // No change - restore original content
            if (task.is_summary && field === 'name') {
                renderGanttRows();
                return;
            }
            cell.textContent = originalContent;
        }
    };

    input.addEventListener('blur', saveEdit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            saveEdit();
        } else if (e.key === 'Escape') {
            cell.classList.remove('editing');
            if (task.is_summary && field === 'name') {
                renderGanttRows();
                return;
            }
            cell.textContent = originalContent;
        }
    });
}

function makePriorityEditable(cell, task, taskIndex) {
    if (cell.classList.contains('editing')) return;

    const originalContent = cell.textContent;
    cell.classList.add('editing');

    const select = document.createElement('select');
    select.style.width = '100%';
    select.style.padding = '2px';
    select.style.fontSize = 'inherit';

    const options = ['Low', 'Medium', 'Important', 'Urgent'];
    options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt;
        if (opt === (task.priority || 'Low')) {
            option.selected = true;
        }
        select.appendChild(option);
    });

    cell.textContent = '';
    cell.appendChild(select);
    select.focus();

    const saveEdit = () => {
        cell.classList.remove('editing');
        const newValue = select.value;
        if (newValue !== originalContent) {
            task.priority = newValue;
            ganttTasks[taskIndex].priority = newValue;
            syncGanttPriorityToEditor(task, taskIndex);
            cell.textContent = newValue;
            // Update styling
            cell.classList.remove('priority-urgent', 'priority-important', 'priority-medium');
            if (newValue === 'Urgent') cell.classList.add('priority-urgent');
            else if (newValue === 'Important') cell.classList.add('priority-important');
            else if (newValue === 'Medium') cell.classList.add('priority-medium');
        } else {
            cell.textContent = originalContent;
        }
    };

    select.addEventListener('blur', saveEdit);
    select.addEventListener('change', saveEdit);
}

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
    };

    bar.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

function updateTaskDates(task, taskIndex, handleType, deltaDays) {
    // Use parseLocalDate to avoid timezone issues
    const startDate = parseLocalDate(task.start);
    const finishDate = parseLocalDate(task.finish);

    if (handleType === 'left') {
        startDate.setDate(startDate.getDate() + deltaDays);
        task.start = startDate.toISOString().split('T')[0];
        ganttTasks[taskIndex].start = task.start;
    } else if (handleType === 'right') {
        finishDate.setDate(finishDate.getDate() + deltaDays);
        task.finish = finishDate.toISOString().split('T')[0];
        ganttTasks[taskIndex].finish = task.finish;
    } else {
        // Move both dates
        startDate.setDate(startDate.getDate() + deltaDays);
        finishDate.setDate(finishDate.getDate() + deltaDays);
        task.start = startDate.toISOString().split('T')[0];
        task.finish = finishDate.toISOString().split('T')[0];
        ganttTasks[taskIndex].start = task.start;
        ganttTasks[taskIndex].finish = task.finish;
    }

    // Recalculate duration by counting days (same method as rendering)
    const newStartDate = parseLocalDate(task.start);
    const newFinishDate = parseLocalDate(task.finish);

    // Milestones (0-duration) stay as 0 when moved
    if (newStartDate.getTime() === newFinishDate.getTime() && task.duration_days === 0) {
        task.duration_days = 0;
        ganttTasks[taskIndex].duration_days = 0;
    } else {
        // Count days from start to finish (inclusive)
        let taskDuration = 1; // Start day counts as 1
        let tempDate = new Date(newStartDate);
        while (tempDate < newFinishDate) {
            tempDate.setDate(tempDate.getDate() + 1);
            taskDuration++;
        }

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

function syncGanttEditToEditor(task, taskIndex, field, newValue, oldName = null) {
    // Get the editor content
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const lines = editor.value.split('\n');

    // For name field, search using oldName; otherwise use task.name
    const searchName = (field === 'name' && oldName) ? oldName : task.name;

    // Find the task line (need to match by task name and level)
    const indentSpaces = task.level > 0 ? (task.level - 1) * 2 : 0;
    const indent = ' '.repeat(indentSpaces);
    const escapedSearchName = searchName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const taskNamePattern = new RegExp(`^${indent}\\*?${escapedSearchName}`);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (taskNamePattern.test(line)) {
            // Update the field in the line
            if (field === 'name') {
                // Replace task name (preserve rest of line)
                // Account for optional * prefix (milestone marker)
                const prefix = line.substring(indent.length).startsWith('*') ? '*' : '';
                const rest = line.substring(indent.length + prefix.length + searchName.length);
                lines[i] = indent + prefix + newValue + rest;
            } else if (field === 'resources') {
                // Update resources - need to find and replace resource pattern
                const resourcePattern = /\[([^\]]+)\]/;
                if (newValue) {
                    if (resourcePattern.test(line)) {
                        lines[i] = line.replace(resourcePattern, `[${newValue}]`);
                    } else {
                        // Add resources if not present
                        lines[i] = line.trimEnd() + ` [${newValue}]`;
                    }
                } else {
                    // Remove resources
                    lines[i] = line.replace(resourcePattern, '').trimEnd();
                }
            } else if (field === 'comment') {
                // Update comment - use "quoted" format matching backend parser
                const commentPattern = /"([^"]*)"/;
                if (newValue) {
                    if (commentPattern.test(line)) {
                        lines[i] = line.replace(commentPattern, `"${newValue}"`);
                    } else {
                        // Add comment if not present
                        lines[i] = line.trimEnd() + ` "${newValue}"`;
                    }
                } else {
                    // Remove comment
                    lines[i] = line.replace(commentPattern, '').trimEnd();
                }
            } else if (field === 'bucket') {
                // Update bucket - use {BucketName} format
                const bucketPattern = /\{([^}]*)\}/;
                if (newValue) {
                    if (bucketPattern.test(line)) {
                        lines[i] = line.replace(bucketPattern, `{${newValue}}`);
                    } else {
                        // Add bucket if not present
                        lines[i] = line.trimEnd() + ` {${newValue}}`;
                    }
                } else {
                    // Remove bucket
                    lines[i] = line.replace(bucketPattern, '').trimEnd();
                }
            }

            // Update editor
            editor.value = lines.join('\n');
            editor.dispatchEvent(new Event('input'));
            break;
        }
    }
}

function syncGanttPriorityToEditor(task, taskIndex) {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const lines = editor.value.split('\n');
    const indentSpaces = task.level > 0 ? (task.level - 1) * 2 : 0;
    const indent = ' '.repeat(indentSpaces);
    const escapedName = task.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const taskNamePattern = new RegExp(`^${indent}\\*?${escapedName}`);

    // Map priority to ! markers
    const priorityMarkers = { 'Urgent': '!!!', 'Important': '!!', 'Medium': '!' };
    const marker = priorityMarkers[task.priority] || '';

    for (let i = 0; i < lines.length; i++) {
        if (taskNamePattern.test(lines[i])) {
            // Remove existing priority markers (standalone !, !!, !!!)
            let line = lines[i].replace(/(?<!\w)(!!!|!!|!)(?!["'{])/g, '').replace(/\s{2,}/g, ' ').trimEnd();
            // Add new marker if not Low
            if (marker) {
                // Add marker after the task name portion
                const nameEnd = indent.length + (line.substring(indent.length).startsWith('*') ? 1 : 0) + task.name.length;
                line = line.substring(0, nameEnd) + ' ' + marker + line.substring(nameEnd);
            }
            lines[i] = line;
            editor.value = lines.join('\n');
            editor.dispatchEvent(new Event('input'));
            break;
        }
    }
}

function syncGanttDurationToEditor(task, taskIndex) {
    console.log('syncGanttDurationToEditor called:', { task: task.name, duration_days: task.duration_days, level: task.level });

    // Get the editor content
    const editor = document.getElementById('planEditor');
    if (!editor) {
        console.error('Editor not found!');
        return;
    }

    const lines = editor.value.split('\n');

    // Calculate indent: level represents hierarchy depth (root=0, first level=1, etc.)
    // Editor uses 2 spaces per indent level, and indent = (level - 1) since level 1 = no indent
    const indentSpaces = task.level > 0 ? (task.level - 1) * 2 : 0;
    const indent = ' '.repeat(indentSpaces);

    // Task name pattern: match indent + optional * (dependency marker) + task name
    const escapedTaskName = task.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const taskNamePattern = new RegExp(`^${indent}\\*?${escapedTaskName}`);

    console.log('Looking for task with indent:', JSON.stringify(indent), 'spaces:', indentSpaces, 'name:', task.name, 'pattern allows *');

    // Find the task line by matching indent and task name
    let found = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (taskNamePattern.test(line)) {
            console.log('Found task at line', i + 1, ':', line);

            // Parse line into tokens, update duration token, rebuild line
            const updatedLine = updateDurationInLine(line, task.duration_days, indent, task.name);
            console.log('Updated line:', updatedLine);

            lines[i] = updatedLine;

            // Update editor
            editor.value = lines.join('\n');
            editor.dispatchEvent(new Event('input'));
            found = true;
            break;
        }
    }

    if (!found) {
        console.error('Task not found in editor!', { name: task.name, level: task.level, indent: JSON.stringify(indent), indentSpaces });
    }
}

function syncGanttStartDateToEditor(task, taskIndex) {
    console.log('syncGanttStartDateToEditor called:', { task: task.name, start: task.start, level: task.level });

    // Get the editor content
    const editor = document.getElementById('planEditor');
    if (!editor) {
        console.error('Editor not found!');
        return;
    }

    const lines = editor.value.split('\n');

    // Calculate indent
    const indentSpaces = task.level > 0 ? (task.level - 1) * 2 : 0;
    const indent = ' '.repeat(indentSpaces);

    // Task name pattern: match indent + optional * (dependency marker) + task name
    const escapedTaskName = task.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const taskNamePattern = new RegExp(`^${indent}\\*?${escapedTaskName}`);

    console.log('Looking for task to update start date:', task.name, 'new start:', task.start, 'pattern allows *');

    // Find the task line by matching indent and task name
    let found = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (taskNamePattern.test(line)) {
            console.log('Found task at line', i + 1, ':', line);

            // Parse line into tokens, update start date, rebuild line
            const updatedLine = updateStartDateInLine(line, task.start, indent, task.name);
            console.log('Updated line:', updatedLine);

            lines[i] = updatedLine;

            // Update editor
            editor.value = lines.join('\n');
            editor.dispatchEvent(new Event('input'));
            found = true;
            break;
        }
    }

    if (!found) {
        console.error('Task not found in editor!', { name: task.name, level: task.level });
    }
}

function syncGanttFinishDateToEditor(task, taskIndex) {
    console.log('syncGanttFinishDateToEditor called:', { task: task.name, finish: task.finish, level: task.level });

    const editor = document.getElementById('planEditor');
    if (!editor) {
        console.error('Editor not found!');
        return;
    }

    const lines = editor.value.split('\n');

    // Calculate indent
    const indentSpaces = task.level > 0 ? (task.level - 1) * 2 : 0;
    const indent = ' '.repeat(indentSpaces);

    // Task name pattern
    const escapedTaskName = task.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const taskNamePattern = new RegExp(`^${indent}\\*?${escapedTaskName}`);

    console.log('Looking for task to update finish date:', task.name, 'new finish:', task.finish);

    let found = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (taskNamePattern.test(line)) {
            console.log('Found task at line', i + 1, ':', line);

            const updatedLine = updateFinishDateInLine(line, task.finish, indent, task.name);
            console.log('Updated line:', updatedLine);

            lines[i] = updatedLine;

            editor.value = lines.join('\n');
            editor.dispatchEvent(new Event('input'));
            found = true;
            break;
        }
    }

    if (!found) {
        console.error('Task not found in editor!', { name: task.name, level: task.level });
    }
}

function syncGanttPercentToEditor(task, taskIndex) {
    console.log('syncGanttPercentToEditor called:', { task: task.name, percent: task.percent, level: task.level });

    const editor = document.getElementById('planEditor');
    if (!editor) {
        console.error('Editor not found!');
        return;
    }

    const lines = editor.value.split('\n');

    // Calculate indent
    const indentSpaces = task.level > 0 ? (task.level - 1) * 2 : 0;
    const indent = ' '.repeat(indentSpaces);

    // Task name pattern
    const escapedTaskName = task.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const taskNamePattern = new RegExp(`^${indent}\\*?${escapedTaskName}`);

    console.log('Looking for task to update percent:', task.name, 'new percent:', task.percent);

    let found = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (taskNamePattern.test(line)) {
            console.log('Found task at line', i + 1, ':', line);

            const updatedLine = updatePercentInLine(line, task.percent, indent, task.name);
            console.log('Updated line:', updatedLine);

            lines[i] = updatedLine;

            editor.value = lines.join('\n');
            editor.dispatchEvent(new Event('input'));
            found = true;
            break;
        }
    }

    if (!found) {
        console.error('Task not found in editor!', { name: task.name, level: task.level });
    }
}

function syncGanttPredecessorsToEditor(task, taskIndex) {
    console.log('syncGanttPredecessorsToEditor called:', { task: task.name, depends: task.depends, lag_lead: task.lag_lead });

    const editor = document.getElementById('planEditor');
    if (!editor) {
        console.error('Editor not found!');
        return;
    }

    const lines = editor.value.split('\n');

    const indentSpaces = task.level > 0 ? (task.level - 1) * 2 : 0;
    const indent = ' '.repeat(indentSpaces);

    const escapedTaskName = task.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const taskNamePattern = new RegExp(`^${indent}\\*?${escapedTaskName}`);

    let found = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (taskNamePattern.test(line)) {
            console.log('Found task at line', i + 1, ':', line);

            // Build the new [depends ...] string
            let newDependsStr = '';
            if (task.depends && task.depends.length > 0) {
                const depParts = task.depends.map(depName => {
                    const lag = (task.lag_lead && task.lag_lead[depName]) ? ' ' + task.lag_lead[depName] : '';
                    return depName + lag;
                });
                newDependsStr = '[depends ' + depParts.join(', ') + ']';
            }

            // Replace or add/remove the [depends ...] block in the line
            const dependsPattern = /\[depends\s+[^\]]+\]/i;
            let updatedLine;
            if (dependsPattern.test(line)) {
                if (newDependsStr) {
                    updatedLine = line.replace(dependsPattern, newDependsStr);
                } else {
                    // Remove the depends block
                    updatedLine = line.replace(dependsPattern, '').replace(/\s{2,}/g, ' ').trimEnd();
                }
            } else {
                if (newDependsStr) {
                    updatedLine = line.trimEnd() + ' ' + newDependsStr;
                } else {
                    updatedLine = line;
                }
            }

            console.log('Updated line:', updatedLine);
            lines[i] = updatedLine;

            editor.value = lines.join('\n');
            editor.dispatchEvent(new Event('input'));
            found = true;
            break;
        }
    }

    if (!found) {
        console.error('Task not found in editor!', { name: task.name, level: task.level });
    }
}

/**
 * Update duration in a task line by tokenizing, replacing duration token, and rebuilding
 * This avoids fragile regex replacements and handles all edge cases
 */
function updateDurationInLine(line, newDurationDays, indent, taskName) {
    // Strip the indent from the line first, then tokenize
    const lineWithoutIndent = line.substring(indent.length);

    // Tokenize the line (split by spaces but preserve quoted strings and brackets)
    const tokens = [];
    let currentToken = '';
    let inQuotes = false;
    let inBrackets = false;

    for (let i = 0; i < lineWithoutIndent.length; i++) {
        const char = lineWithoutIndent[i];

        if (char === '"' && !inBrackets) {
            inQuotes = !inQuotes;
            currentToken += char;
        } else if (char === '[' && !inQuotes) {
            inBrackets = true;
            currentToken += char;
        } else if (char === ']' && !inQuotes) {
            inBrackets = false;
            currentToken += char;
        } else if (char === ' ' && !inQuotes && !inBrackets) {
            if (currentToken) {
                tokens.push(currentToken);
                currentToken = '';
            }
        } else {
            currentToken += char;
        }
    }

    // Push last token
    if (currentToken) {
        tokens.push(currentToken);
    }

    // Find and replace duration token
    let foundDuration = false;
    for (let i = 0; i < tokens.length; i++) {
        // Duration token format: digits followed by d/w/m/y
        if (/^\d+[dwmy]$/.test(tokens[i])) {
            tokens[i] = `${newDurationDays}d`;
            foundDuration = true;
            break;
        }
    }

    // If no duration found, add it after task name (first token)
    if (!foundDuration) {
        tokens.splice(1, 0, `${newDurationDays}d`);
    }

    // Rebuild line with indent preserved
    return indent + tokens.join(' ');
}

/**
 * Update start date in a task line by tokenizing, replacing/adding date token, and rebuilding
 */
function updateStartDateInLine(line, newStartDate, indent, taskName) {
    // Strip the indent from the line first, then tokenize
    const lineWithoutIndent = line.substring(indent.length);

    // Tokenize the line (split by spaces but preserve quoted strings and brackets)
    const tokens = [];
    let currentToken = '';
    let inQuotes = false;
    let inBrackets = false;

    for (let i = 0; i < lineWithoutIndent.length; i++) {
        const char = lineWithoutIndent[i];

        if (char === '"' && !inBrackets) {
            inQuotes = !inQuotes;
            currentToken += char;
        } else if (char === '[' && !inQuotes) {
            inBrackets = true;
            currentToken += char;
        } else if (char === ']' && !inQuotes) {
            inBrackets = false;
            currentToken += char;
        } else if (char === ' ' && !inQuotes && !inBrackets) {
            if (currentToken) {
                tokens.push(currentToken);
                currentToken = '';
            }
        } else {
            currentToken += char;
        }
    }

    // Push last token
    if (currentToken) {
        tokens.push(currentToken);
    }

    // Find and replace start date token (format: YYYY-MM-DD)
    // Date should come after duration, resources, percent
    let foundDate = false;
    for (let i = 0; i < tokens.length; i++) {
        // Date token format: YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}$/.test(tokens[i])) {
            tokens[i] = newStartDate;
            foundDate = true;
            break;
        }
    }

    // If no date found, add it after percent (or after resources if no percent, or after duration)
    if (!foundDate) {
        // Find the right position: after task name, duration, resources, percent
        let insertIndex = 1; // Default: after task name

        // Look for duration, resources, percent to find the right insertion point
        for (let i = 1; i < tokens.length; i++) {
            if (/^\d+[dwmy]$/.test(tokens[i])) {
                insertIndex = i + 1; // After duration
            } else if (tokens[i].startsWith('@')) {
                insertIndex = i + 1; // After resources
            } else if (/^\d+%$/.test(tokens[i])) {
                insertIndex = i + 1; // After percent
                break; // Percent is usually last before dates
            }
        }

        tokens.splice(insertIndex, 0, newStartDate);
    }

    // Rebuild line with indent preserved
    return indent + tokens.join(' ');
}

function updateFinishDateInLine(line, newFinishDate, indent, taskName) {
    // Strip the indent from the line first, then tokenize
    const lineWithoutIndent = line.substring(indent.length);

    // Tokenize the line
    const tokens = [];
    let currentToken = '';
    let inQuotes = false;
    let inBrackets = false;

    for (let i = 0; i < lineWithoutIndent.length; i++) {
        const char = lineWithoutIndent[i];

        if (char === '"' && !inBrackets) {
            inQuotes = !inQuotes;
            currentToken += char;
        } else if (char === '[' && !inQuotes) {
            inBrackets = true;
            currentToken += char;
        } else if (char === ']' && !inQuotes) {
            inBrackets = false;
            currentToken += char;
        } else if (char === ' ' && !inQuotes && !inBrackets) {
            if (currentToken) {
                tokens.push(currentToken);
                currentToken = '';
            }
        } else {
            currentToken += char;
        }
    }

    if (currentToken) {
        tokens.push(currentToken);
    }

    // Find and replace finish date token (second date in line, after start date)
    let dateCount = 0;
    let foundFinishDate = false;
    for (let i = 0; i < tokens.length; i++) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(tokens[i])) {
            dateCount++;
            if (dateCount === 2) {
                // This is the finish date (second date)
                tokens[i] = newFinishDate;
                foundFinishDate = true;
                break;
            }
        }
    }

    // If no finish date found, add it after start date
    if (!foundFinishDate) {
        // Find the start date position
        for (let i = 0; i < tokens.length; i++) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(tokens[i])) {
                // Insert finish date after start date
                tokens.splice(i + 1, 0, newFinishDate);
                foundFinishDate = true;
                break;
            }
        }
    }

    // Rebuild line with indent preserved
    return indent + tokens.join(' ');
}

function updatePercentInLine(line, newPercent, indent, taskName) {
    // Strip the indent from the line first, then tokenize
    const lineWithoutIndent = line.substring(indent.length);

    // Tokenize the line
    const tokens = [];
    let currentToken = '';
    let inQuotes = false;
    let inBrackets = false;

    for (let i = 0; i < lineWithoutIndent.length; i++) {
        const char = lineWithoutIndent[i];

        if (char === '"' && !inBrackets) {
            inQuotes = !inQuotes;
            currentToken += char;
        } else if (char === '[' && !inQuotes) {
            inBrackets = true;
            currentToken += char;
        } else if (char === ']' && !inQuotes) {
            inBrackets = false;
            currentToken += char;
        } else if (char === ' ' && !inQuotes && !inBrackets) {
            if (currentToken) {
                tokens.push(currentToken);
                currentToken = '';
            }
        } else {
            currentToken += char;
        }
    }

    if (currentToken) {
        tokens.push(currentToken);
    }

    // Find and replace percent token (format: XX%)
    let foundPercent = false;
    for (let i = 0; i < tokens.length; i++) {
        if (/^\d+%$/.test(tokens[i])) {
            tokens[i] = newPercent;
            foundPercent = true;
            break;
        }
    }

    // If no percent found, add it after duration (or after task name if no duration)
    if (!foundPercent) {
        let insertIndex = 1; // Default: after task name

        // Find duration to insert after it
        for (let i = 1; i < tokens.length; i++) {
            if (/^\d+[dwmy]$/.test(tokens[i])) {
                insertIndex = i + 1; // After duration
                break;
            }
        }

        tokens.splice(insertIndex, 0, newPercent);
    }

    // Rebuild line with indent preserved
    return indent + tokens.join(' ');
}

function calculateRAGCounts(asciiOutput) {
    // Count occurrences of Red, Amber, Green in the ASCII output
    const redMatches = asciiOutput.match(/Red/g) || [];
    const amberMatches = asciiOutput.match(/Amber/g) || [];
    const greenMatches = asciiOutput.match(/Green/g) || [];

    return {
        red: redMatches.length,
        amber: amberMatches.length,
        green: greenMatches.length
    };
}

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

function downloadMarkdown() {
    const editor = document.getElementById('planEditor');
    const content = editor.value;

    if (!content.trim()) {
        showMessage('editor', 'error', 'Nothing to save - editor is empty');
        return;
    }

    // Create a blob with the markdown content
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = window.URL.createObjectURL(blob);

    // Create download link
    const a = document.createElement('a');
    a.href = url;

    // Generate filename with timestamp
    const now = new Date();
    const timestamp = now.toISOString().slice(0, 19).replace(/:/g, '-').replace('T', '_');
    a.download = `plan_${timestamp}.md`;

    // Trigger download
    document.body.appendChild(a);
    a.click();

    // Cleanup
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    showMessage('editor', 'success', 'Markdown file downloaded!');
}

// Task Form Modal Functions
let currentTask = null;  // Will hold the Task instance being edited
let userSetStartDate = false;  // Track if user explicitly set start date
let userSetFinishDate = false;  // Track if user explicitly set finish date
let userSetDuration = false;  // Track if user explicitly set duration

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
        let latestFinishDate = null;

        for (const depEntry of depEntries) {
            // Strip lag/lead time (e.g., "+2d", "-1w") from dependency name
            const lagLeadMatch = depEntry.match(/^(.+?)\s+[+\-]\d+[dwmy]$/);
            const depName = lagLeadMatch ? lagLeadMatch[1].trim() : depEntry;

            // Look up dependency in the map
            const depTask = taskMap.get(depName);
            if (depTask) {
                // Recursively calculate dependency dates if not set
                if (!depTask.finishDate) {
                    calculateTaskDates(depTask, taskMap, lines, visited);
                }
                if (depTask.finishDate) {
                    if (!latestFinishDate || depTask.finishDate > latestFinishDate) {
                        latestFinishDate = depTask.finishDate;
                    }
                }
            }
        }

        // If we found a dependency finish date, calculate start date
        if (latestFinishDate) {
            // Start on the same day the dependency finishes
            task.startDate = latestFinishDate;
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

function openTaskForm(lineNumber) {
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

        // Track which fields were in the original task (user set)
        const originalStartDate = task.startDate;
        const originalFinishDate = task.finishDate;
        const originalDuration = task.duration;

        // Build a map of all tasks by name for dependency lookup
        const taskMap = new Map();
        for (let i = 0; i < lines.length; i++) {
            const t = parseTaskLine(lines[i], i + 1);
            if (t.name) {
                taskMap.set(t.name, t);
            }
        }

        // Calculate dates for this task (will recursively calculate dependencies)
        calculateTaskDates(task, taskMap, lines);

        // Mark which fields are user-set vs auto-calculated
        userSetStartDate = !!originalStartDate;
        userSetFinishDate = !!originalFinishDate;
        userSetDuration = !!originalDuration;

        // Populate form
        document.getElementById('taskName').value = task.name || '';
        document.getElementById('taskFormTitle').textContent = task.name || 'Task Name';

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

        document.getElementById('taskPercent').value = task.percent || '';
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

        currentTaskLineNumber = lineNumber;
        updateRagDisplay();
        updateProgressBar();

        // Populate subtasks
        populateSubtasks(lineNumber, lines);

        openDetailPane('taskFormSection');
    } catch (error) {
        console.error('Error opening task form for line', lineNumber, ':', error);
        // Still try to open the pane even if there was an error populating some fields
        openDetailPane('taskFormSection');
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

function populateSubtasks(parentLineNumber, lines) {
    const subtasksList = document.getElementById('subtasksList');
    if (!subtasksList) return;

    subtasksList.innerHTML = '';

    // Get parent task indentation level
    const parentLine = lines[parentLineNumber - 1];
    const parentIndent = parentLine.search(/\S/); // Find first non-whitespace character

    // Find all child tasks (tasks with greater indentation on subsequent lines)
    const subtasks = [];
    for (let i = parentLineNumber; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Skip empty lines
        if (!trimmed) continue;

        // Skip front matter, phase headers, summary lines
        if (trimmed.startsWith('---') || trimmed.startsWith('#') || trimmed.includes('===')) continue;

        const indent = line.search(/\S/);

        // If we hit a line at same or lower indentation, we're done
        if (indent <= parentIndent && i > parentLineNumber) {
            break;
        }

        // Check if this is a direct child (one level more indented)
        if (i > parentLineNumber - 1 && indent > parentIndent) {
            // Check if it's a direct child (immediate next level)
            const indentDiff = indent - parentIndent;
            if (indentDiff === 2 || indentDiff === 4) { // 2 spaces or 4 spaces = one level
                const task = parseTaskLine(line, i + 1);
                if (task.name) {
                    subtasks.push({
                        ...task,
                        lineNumber: i + 1
                    });
                }
            }
        }
    }

    // Display subtasks
    if (subtasks.length === 0) {
        subtasksList.innerHTML = '<div style="padding: 10px; color: #999; text-align: center;">No sub tasks</div>';
        // Enable percent input for non-summary tasks
        const percentInput = document.getElementById('taskPercent');
        const helperText = document.getElementById('percentHelperText');
        if (percentInput) {
            percentInput.readOnly = false;
            percentInput.style.backgroundColor = '';
            percentInput.style.cursor = '';
        }
        if (helperText) {
            helperText.style.display = 'none';
        }
        return subtasks;
    }

    subtasks.forEach(subtask => {
        const item = document.createElement('div');
        item.className = 'subtask-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'subtask-checkbox round-checkbox';
        checkbox.checked = parseInt(subtask.percent) === 100;
        checkbox.addEventListener('change', () => toggleSubtaskCompletion(subtask.lineNumber, checkbox.checked));

        const label = document.createElement('span');
        label.className = 'subtask-label';
        label.textContent = subtask.name;
        label.addEventListener('click', () => {
            // Navigate directly to the subtask's details
            openTaskForm(subtask.lineNumber);
        });

        // Show completion percentage if not 0 or 100
        const percent = parseInt(subtask.percent) || 0;
        if (percent > 0 && percent < 100) {
            const percentBadge = document.createElement('span');
            percentBadge.className = 'subtask-percent';
            percentBadge.textContent = `${percent}%`;
            label.appendChild(percentBadge);
        }

        item.appendChild(checkbox);
        item.appendChild(label);
        subtasksList.appendChild(item);
    });

    // Calculate average completion for summary tasks
    const totalPercent = subtasks.reduce((sum, task) => sum + (parseInt(task.percent) || 0), 0);
    const avgPercent = Math.round(totalPercent / subtasks.length);

    // Update percent field and make it read-only
    const percentInput = document.getElementById('taskPercent');
    const helperText = document.getElementById('percentHelperText');
    if (percentInput) {
        percentInput.value = avgPercent;
        percentInput.readOnly = true;
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

function toggleSubtaskCompletion(lineNumber, isComplete) {
    const editor = document.getElementById('planEditor');
    const lines = editor.value.split('\n');
    const line = lines[lineNumber - 1];

    // Parse the task
    const task = parseTaskLine(line, lineNumber);

    // Update or add percent
    let updatedLine = line;

    if (isComplete) {
        // Set to 100%
        if (task.percent) {
            // Replace existing percent
            updatedLine = updatedLine.replace(/\d+%/, '100%');
        } else {
            // Add 100% to the end
            updatedLine = updatedLine.trimEnd() + ' 100%';
        }
    } else {
        // Set to 0%
        if (task.percent) {
            updatedLine = updatedLine.replace(/\d+%/, '0%');
        } else {
            // Add 0% to the end
            updatedLine = updatedLine.trimEnd() + ' 0%';
        }
    }

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

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'subtask-checkbox round-checkbox';
    checkbox.disabled = true;

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

    item.appendChild(checkbox);
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
    const title = document.getElementById('taskFormTitle').textContent.trim();
    document.getElementById('taskName').value = title;
    saveTask();
}

function updateRagDisplay() {
    const percent = parseInt(document.getElementById('taskPercent').value) || 0;
    const startDateStr = document.getElementById('taskStartDate').value;
    const finishDateStr = document.getElementById('taskFinishDate').value;
    const ragDisplay = document.getElementById('ragDisplay');
    const ragReasoning = document.getElementById('ragReasoning');

    let ragStatus, bgColor, textColor, reasoning;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // RAG logic based on backend rules (from calculate_rag_status):

    // Green: Task is 100% complete
    if (percent === 100) {
        ragStatus = 'Green';
        bgColor = '#4caf50';
        textColor = 'white';
        reasoning = 'Task is complete';
    }
    // Green: Task hasn't started yet (start date is in the future)
    else if (startDateStr && new Date(startDateStr) > today) {
        ragStatus = 'Green';
        bgColor = '#4caf50';
        textColor = 'white';
        reasoning = 'Task not due to start yet';
    }
    // Red: Start date is in the past and no progress or 0%
    else if (startDateStr && new Date(startDateStr) <= today && percent === 0) {
        ragStatus = 'Red';
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
            ragStatus = 'Amber';
            bgColor = '#ff9800';
            textColor = 'white';
            reasoning = 'Behind schedule: ' + percent + '% complete, expected ' + Math.round(expectedPercent) + '%';
        } else {
            // Green: On track or ahead
            ragStatus = 'Green';
            bgColor = '#4caf50';
            textColor = 'white';
            reasoning = 'On track or ahead of schedule';
        }
    }
    // Fallback: Use simple percentage thresholds if no dates
    else if (percent === 0) {
        ragStatus = 'Red';
        bgColor = '#f44336';
        textColor = 'white';
        reasoning = 'No progress made';
    } else if (percent < 50) {
        ragStatus = 'Red';
        bgColor = '#f44336';
        textColor = 'white';
        reasoning = 'Progress below 50%';
    } else if (percent < 80) {
        ragStatus = 'Amber';
        bgColor = '#ff9800';
        textColor = 'white';
        reasoning = 'Progress 50-79%';
    } else {
        ragStatus = 'Green';
        bgColor = '#4caf50';
        textColor = 'white';
        reasoning = 'Progress ≥80%';
    }

    ragDisplay.textContent = ragStatus;
    ragDisplay.style.backgroundColor = bgColor;
    ragDisplay.style.color = textColor;
    ragReasoning.textContent = reasoning;
}

function updateProgressBar() {
    const percent = parseInt(document.getElementById('taskPercent').value) || 0;
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');

    progressBar.style.width = percent + '%';
    progressBar.setAttribute('aria-valuenow', percent);
    progressText.textContent = percent > 0 ? percent + '%' : '';

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
}

function closeTaskForm() {
    closeDetailPane();
    currentTaskLineNumber = null;
}

/**
 * Add a new row to the dependencies table
 */
function addDependencyRow(taskName = '', lagLead = '') {
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
            <input type="text" class="dependency-lag-lead" placeholder="e.g., +2d, -1w" value="${lagLead}" oninput="saveTask()">
        </td>
        <td>
            <button type="button" class="remove-dependency-btn" onclick="removeDependencyRow(this)">×</button>
        </td>
    `;

    tbody.appendChild(row);
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

    // Parse dependencies string like "Task1, Task2 +2d, Task3 -1w"
    // This comes from [depends Task1, Task2 +2d] syntax
    const deps = dependenciesStr.split(',').map(d => d.trim()).filter(d => d);

    deps.forEach(dep => {
        // Check if this dependency has lag/lead time
        const lagLeadMatch = dep.match(/^(.+?)\s+([+\-]\d+[dwmy])$/);

        if (lagLeadMatch) {
            // Has lag/lead: "Task Name +2d"
            addDependencyRow(lagLeadMatch[1].trim(), lagLeadMatch[2]);
        } else {
            // No lag/lead: just "Task Name"
            addDependencyRow(dep, '');
        }
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
        const lagLead = row.querySelector('.dependency-lag-lead').value.trim();

        if (taskName) {
            if (lagLead) {
                deps.push(`${taskName} ${lagLead}`);
            } else {
                deps.push(taskName);
            }
        }
    });

    return deps.join(', ');
}

function saveTask() {
    if (currentTaskLineNumber === null) return;

    const editor = document.getElementById('planEditor');
    const lines = editor.value.split('\n');
    const originalLine = lines[currentTaskLineNumber - 1];

    // Safety check - if line doesn't exist, return
    if (!originalLine && originalLine !== '') {
        console.error('Task line not found at line number:', currentTaskLineNumber, 'Total lines:', lines.length);
        return;
    }

    // Get form values
    const name = document.getElementById('taskName').value.trim();
    const duration = document.getElementById('taskDuration').value.trim();
    const startDate = document.getElementById('taskStartDate').value.trim();
    const finishDate = document.getElementById('taskFinishDate').value.trim();
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
                // Complete lag/lead: "Task Name +2d"
                // Always use [depends] syntax for lag/lead, even if it's the previous task
                allDependenciesForBrackets.push(dep);
            } else {
                // Incomplete lag/lead (e.g., "+", "+2", "2d" without sign)
                // Treat as if no lag/lead, but preserve the string in [depends]
                allDependenciesForBrackets.push(dep);
            }
        } else {
            // No lag/lead: just "Task Name"
            if (dep === previousTaskName) {
                // Simple dependency on previous task - use * notation
                dependsOnPreviousSimple = true;
            } else {
                // Other task without lag/lead - use [depends] syntax
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

    // Add duration
    if (duration) newLine += ' ' + duration + 'd';

    // Add resources - split by comma and add @ prefix to each
    if (resources) {
        const resourceList = resources.split(',').map(r => r.trim()).filter(r => r);
        resourceList.forEach(resource => {
            newLine += ' @' + resource;
        });
    }

    // Add percent - but only if this is not a summary task
    // Summary tasks have their percent auto-calculated from subtasks
    const percentInput = document.getElementById('taskPercent');
    const isSummaryTask = percentInput && percentInput.readOnly;
    if (percent && !isSummaryTask) newLine += ' ' + percent + '%';

    // Add dates (ISO format) - only if user explicitly set them
    if (startDate && userSetStartDate) newLine += ' ' + startDate;
    if (finishDate && userSetFinishDate) newLine += ' ' + finishDate;

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

    // Update the line
    lines[currentTaskLineNumber - 1] = newLine;
    editor.value = lines.join('\n');

    // Trigger input event to update line numbers and render
    editor.dispatchEvent(new Event('input'));
    setTimeout(() => renderText(), 10);
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
    const task = {
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
        labels: ''
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

    // Handle dependencies (everything in square brackets [depends ...])
    const dependencies = [];
    const dependsMatch = text.match(/\[depends\s+([^\]]+)\]/i);
    if (dependsMatch) {
        // Parse dependencies - can be comma-separated
        const depText = dependsMatch[1];
        dependencies.push(...depText.split(',').map(d => d.trim()).filter(d => d));
        // Remove the dependency from the text
        text = text.replace(/\[depends\s+[^\]]+\]/i, '').trim();
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
                details[shortname] = { name, role };
            }
        }
    }

    return details;
}

// Autocomplete functionality for dependencies and resources
let autocompleteSelectedIndex = -1;
let resourceAutocompleteSelectedIndex = -1;

function getAllTaskNames() {
    const editor = document.getElementById('planEditor');
    if (!editor) return [];

    const lines = editor.value.split('\n');
    const taskNames = [];

    for (let i = 0; i < lines.length; i++) {
        const task = parseTaskLine(lines[i], i + 1);
        if (task.name && task.name.trim()) {
            // Don't include the current task
            if (currentTask && task.lineNumber === currentTask.lineNumber) {
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
let dependencyAutocompleteSelectedIndex = -1;
let currentDependencyInput = null;

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
let labelAutocompleteSelectedIndex = -1;

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
let projectLabelAutocompleteSelectedIndex = -1;

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
function toggleExportMenu(event) {
    event.stopPropagation();
    const menu = document.getElementById('exportMenu');
    menu.classList.toggle('show');
}

// Close export menu when clicking outside
document.addEventListener('click', function(e) {
    const menu = document.getElementById('exportMenu');
    const btn = document.querySelector('.export-btn');
    if (menu && !menu.contains(e.target) && (!btn || !btn.contains(e.target))) {
        menu.classList.remove('show');
    }

    // Also close all nav dropdown menus when clicking outside
    const navMenus = [
        { menu: 'viewsMenu', tab: 'viewsTab' },
        { menu: 'trackingMenu', tab: 'trackingTab' },
        { menu: 'resourcesMenu', tab: 'resourcesTab' },
        { menu: 'helpMenu', tab: 'helpTab' }
    ];
    navMenus.forEach(({ menu: menuId, tab: tabId }) => {
        const navMenu = document.getElementById(menuId);
        const navTab = document.getElementById(tabId);
        if (navMenu && !navMenu.contains(e.target) && (!navTab || !navTab.contains(e.target))) {
            navMenu.classList.remove('show');
        }
    });
});

// Toggle Views dropdown menu
function closeAllNavMenus(except) {
    const menuIds = ['viewsMenu', 'trackingMenu', 'resourcesMenu', 'helpMenu'];
    menuIds.forEach(id => {
        if (id !== except) {
            const m = document.getElementById(id);
            if (m) m.classList.remove('show');
        }
    });
}

function toggleViewsMenu(event) {
    event.stopPropagation();
    closeAllNavMenus('viewsMenu');
    document.getElementById('viewsMenu').classList.toggle('show');
}

// Toggle Tracking dropdown menu
function toggleTrackingMenu(event) {
    event.stopPropagation();
    closeAllNavMenus('trackingMenu');
    document.getElementById('trackingMenu').classList.toggle('show');
}

// Toggle Resources dropdown menu
function toggleResourcesMenu(event) {
    event.stopPropagation();
    closeAllNavMenus('resourcesMenu');
    document.getElementById('resourcesMenu').classList.toggle('show');
}

// Toggle Help dropdown menu
function toggleHelpMenu(event) {
    event.stopPropagation();
    closeAllNavMenus('helpMenu');
    document.getElementById('helpMenu').classList.toggle('show');
}

// Templates Modal Functions
let templatesData = null;
let currentCategory = 'all';

async function openTemplatesModal() {
    const overlay = document.getElementById('templatesModalOverlay');
    const loading = document.getElementById('templatesLoading');
    const error = document.getElementById('templatesError');
    const content = document.getElementById('templatesContent');

    // Show modal
    overlay.style.display = 'flex';
    document.body.classList.add('modal-open');

    // Show loading state
    loading.style.display = 'block';
    error.style.display = 'none';
    content.style.display = 'none';

    try {
        // Load templates data if not already loaded
        if (!templatesData) {
            const response = await fetch('/api/templates');
            if (!response.ok) {
                throw new Error('Failed to load templates');
            }
            templatesData = await response.json();
        }

        // Hide loading, show content
        loading.style.display = 'none';
        content.style.display = 'flex';

        // Render templates
        renderTemplatesModal();

    } catch (err) {
        console.error('Error loading templates:', err);
        loading.style.display = 'none';
        error.style.display = 'block';
        error.textContent = 'Failed to load templates: ' + err.message;
    }
}

function closeTemplatesModal() {
    const overlay = document.getElementById('templatesModalOverlay');
    overlay.style.display = 'none';
    document.body.classList.remove('modal-open');
}

function renderTemplatesModal() {
    if (!templatesData) return;

    // Render categories
    const categoryList = document.getElementById('categoryList');
    categoryList.innerHTML = '<li><a href="#" class="category-link active" data-category="all" onclick="filterTemplates(\'all\')">All Templates</a></li>';

    templatesData.categories.forEach(category => {
        const li = document.createElement('li');
        li.innerHTML = `<a href="#" class="category-link" data-category="${category}" onclick="filterTemplates('${category}')">${category}</a>`;
        categoryList.appendChild(li);
    });

    // Render popular templates
    const popularTemplates = templatesData.templates.filter(t => t.popular);
    renderTemplateGrid('popularTemplatesGrid', popularTemplates);

    // Show/hide start here section based on popular templates
    const startHereSection = document.getElementById('startHereSection');
    if (popularTemplates.length > 0) {
        startHereSection.style.display = 'block';
    } else {
        startHereSection.style.display = 'none';
    }

    // Render all templates
    renderTemplateGrid('allTemplatesGrid', templatesData.templates);
}

function renderTemplateGrid(containerId, templates) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    templates.forEach(template => {
        const card = document.createElement('div');
        card.className = 'template-card';
        card.innerHTML = `
            <div class="template-hero">
                <img src="${template.hero_image || '/static/placeholder-template.png'}" alt="${template.title}" onerror="this.src='/static/placeholder-template.png'">
            </div>
            <div class="template-info">
                <h3>${template.title}</h3>
                <p class="template-description">${template.description}</p>
                <div class="template-meta">
                    <span class="template-category">${template.category}</span>
                    <span class="template-author">by ${template.author}</span>
                </div>
                <button class="template-use-btn" onclick="useTemplate('${template.id}')">Use This Template</button>
            </div>
        `;
        container.appendChild(card);
    });

    if (templates.length === 0) {
        container.innerHTML = '<div class="no-templates">No templates found in this category.</div>';
    }
}

function filterTemplates(category) {
    if (!templatesData) return;

    currentCategory = category;

    // Update active category link
    document.querySelectorAll('.category-link').forEach(link => {
        link.classList.remove('active');
    });
    document.querySelector(`[data-category="${category}"]`).classList.add('active');

    // Filter and render templates
    let filteredTemplates = templatesData.templates;
    if (category !== 'all') {
        filteredTemplates = templatesData.templates.filter(t => t.category === category);
    }

    renderTemplateGrid('allTemplatesGrid', filteredTemplates);
}

async function useTemplate(templateId) {
    const btn = document.querySelector(`.template-use-btn[onclick="useTemplate('${templateId}')"]`);
    const originalText = btn ? btn.textContent : '';

    try {
        // Show loading indicator
        if (btn) {
            btn.textContent = 'Loading...';
            btn.disabled = true;
        }

        // Fetch template content
        const response = await fetch(`/api/templates/${templateId}`);
        if (!response.ok) {
            throw new Error('Failed to load template');
        }

        const template = await response.json();

        // Load template content into editor
        const editor = document.getElementById('planEditor');
        const kanbanEditor = document.getElementById('kanbanPlanEditor');

        if (editor && template.content) {
            editor.value = template.content;

            if (kanbanEditor) {
                kanbanEditor.value = template.content;
            }

            // Trigger input event to update line numbers and syntax highlighting
            editor.dispatchEvent(new Event('input'));
            showMessage('editor', 'success', `Template "${template.title}" loaded successfully! Press Enter to render your plan.`, 5000);
            closeTemplatesModal();
        }

    } catch (err) {
        console.error('Error using template:', err);
        showMessage('editor', 'error', 'Failed to load template: ' + err.message, 5000);

        // Reset button
        if (btn) {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    }
}

// Switch to a specific view (from Views or Tracking dropdown)
function switchToView(viewName) {
    // First, switch to editor tab (where all views live)
    switchTab('editor');

    // Then switch to the specific output tab
    switchOutputTab(viewName);

    // Close the dropdown menus
    // Close all nav dropdown menus
    closeAllNavMenus();
}

// Switch between output tabs (ASCII, Summary, Milestones, etc.)
function switchOutputTab(tabName) {
    // Hide all tab content
    document.querySelectorAll('.output-tab-content').forEach(content => {
        content.classList.remove('active');
    });

    // Remove active from all tab buttons
    document.querySelectorAll('.output-tab').forEach(tab => {
        tab.classList.remove('active');
    });

    // Show selected tab content
    const tabView = document.getElementById(`${tabName}-view`);
    if (tabView) {
        tabView.classList.add('active');
    }

    // Mark selected tab button as active
    const activeTab = document.querySelector(`.output-tab[data-tab="${tabName}"]`);
    if (activeTab) {
        activeTab.classList.add('active');
    }

    // If switching to timeline view, trigger a re-render after layout is ready
    if (tabName === 'timeline' && timelineTasks.length > 0) {
        // Use setTimeout to ensure the browser has fully laid out the
        // newly-visible container before we measure its width
        setTimeout(() => {
            updateTimeline(timelineTasks, timelineProjectName);
        }, 50);
    }

    // If switching to project report view, re-render the report timeline
    if (tabName === 'project-report' && timelineTasks.length > 0) {
        setTimeout(() => {
            updateReportTimeline(timelineTasks, timelineProjectName);
        }, 50);
    }
}

// Resizer functionality
let isResizing = false;
let startX = 0;
let startWidth = 0;

function initResizer() {
    const resizer = document.getElementById('resizer');
    const editorPanel = document.querySelector('.editor-panel');

    if (!resizer || !editorPanel) return;

    resizer.addEventListener('mousedown', function(e) {
        isResizing = true;
        startX = e.clientX;
        startWidth = editorPanel.offsetWidth;
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
        if (!isResizing) return;

        const delta = e.clientX - startX;
        const newWidth = startWidth + delta;
        const container = document.querySelector('.editor-layout');
        const minWidth = 300;
        const maxWidth = container.offsetWidth - 300 - 5;

        if (newWidth >= minWidth && newWidth <= maxWidth) {
            editorPanel.style.flex = 'none';
            editorPanel.style.width = newWidth + 'px';
        }
    });

    document.addEventListener('mouseup', function() {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
        }
    });
}

// Gantt splitter functionality
let isGanttResizing = false;
let ganttStartX = 0;
let ganttStartWidth = 0;

function initGanttSplitter() {
    const splitter = document.getElementById('ganttSplitter');
    const tableSide = document.querySelector('.gantt-table-side');
    const chartSide = document.querySelector('.gantt-chart-side');

    if (!splitter || !tableSide || !chartSide) return;

    // Restore saved width
    const savedWidth = localStorage.getItem('ganttTableWidth');
    if (savedWidth) {
        tableSide.style.width = savedWidth + 'px';
    }

    // Mouse events
    splitter.addEventListener('mousedown', function(e) {
        isGanttResizing = true;
        ganttStartX = e.clientX;
        ganttStartWidth = tableSide.offsetWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
        if (!isGanttResizing) return;

        const delta = e.clientX - ganttStartX;
        const newWidth = ganttStartWidth + delta;
        const wrapper = document.querySelector('.gantt-wrapper');
        const minWidth = 150;
        const maxWidth = wrapper.offsetWidth - 150 - 6;

        if (newWidth >= minWidth && newWidth <= maxWidth) {
            tableSide.style.width = newWidth + 'px';
        }
    });

    document.addEventListener('mouseup', function() {
        if (isGanttResizing) {
            isGanttResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            localStorage.setItem('ganttTableWidth', tableSide.offsetWidth);
        }
    });

    // Touch events for mobile
    splitter.addEventListener('touchstart', function(e) {
        isGanttResizing = true;
        ganttStartX = e.touches[0].clientX;
        ganttStartWidth = tableSide.offsetWidth;
        e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchmove', function(e) {
        if (!isGanttResizing) return;

        const delta = e.touches[0].clientX - ganttStartX;
        const newWidth = ganttStartWidth + delta;
        const wrapper = document.querySelector('.gantt-wrapper');
        const minWidth = 150;
        const maxWidth = wrapper.offsetWidth - 150 - 6;

        if (newWidth >= minWidth && newWidth <= maxWidth) {
            tableSide.style.width = newWidth + 'px';
        }
    }, { passive: false });

    document.addEventListener('touchend', function() {
        if (isGanttResizing) {
            isGanttResizing = false;
            localStorage.setItem('ganttTableWidth', tableSide.offsetWidth);
        }
    });

    // Synchronized vertical scrolling
    setupGanttSyncScroll(tableSide, chartSide);
}

function setupGanttSyncScroll(tableSide, chartSide) {
    let isSyncing = false;

    tableSide.addEventListener('scroll', function() {
        if (isSyncing) return;
        isSyncing = true;
        chartSide.scrollTop = tableSide.scrollTop;
        isSyncing = false;
    });

    chartSide.addEventListener('scroll', function() {
        if (isSyncing) return;
        isSyncing = true;
        tableSide.scrollTop = chartSide.scrollTop;
        isSyncing = false;
    });
}

document.addEventListener('DOMContentLoaded', function() {
    // Initialize resizer
    initResizer();

    // Initialize gantt splitter
    initGanttSplitter();

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
                        case 'highlightFormSection': closeHighlightForm(); break;
                        case 'projectDetailsSection': closeProjectDetailsForm(); break;
                        case 'resourceFormSection': saveResource(); break;
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
            // First check if any autocomplete dropdown is open - close it instead
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
                        case 'highlightFormSection': closeHighlightForm(); break;
                        case 'projectDetailsSection': closeProjectDetailsForm(); break;
                        case 'resourceFormSection': saveResource(); break;
                        default: closeDetailPane();
                    }
                } else {
                    closeDetailPane();
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
        const firstInput = document.getElementById('projectOwner');
        if (firstInput) firstInput.focus();
    }, 100);
}

function closeProjectDetailsForm() {
    closeDetailPane();
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

    // If editing existing resource, populate form
    if (existingShortname) {
        populateResourceForm(existingShortname);
    }

    openDetailPane('resourceFormSection');

    // Focus on first field
    setTimeout(() => {
        document.getElementById('resourceShortname').focus();
    }, 100);
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
            // Parse resource line: - @shortname: Full Name, Role, email, allocation%
            const match = line.match(/^-\s*@([^:]+):\s*(.+)$/);
            console.log('Checking resource line:', line, 'match:', match);
            if (match && match[1].trim().toLowerCase() === shortnameLC) {
                console.log('Found matching resource!', match[1].trim(), '(case-insensitive match with)', shortname);
                const parts = match[2].split(',').map(p => p.trim());
                document.getElementById('resourceShortname').value = shortname;
                document.getElementById('resourceFullName').value = parts[0] || '';
                document.getElementById('resourceRole').value = parts[1] || '';
                document.getElementById('resourceEmail').value = parts[2] || '';

                // Parse allocation percentage
                if (parts[3] && parts[3].includes('%')) {
                    document.getElementById('resourceAllocation').value = parts[3].replace('%', '').trim();
                }
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
let resourceDebounceTimer = null;

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

    // Build resource line
    let resourceParts = [fullName];
    if (role) resourceParts.push(role);
    if (email) resourceParts.push(email);
    if (allocation) resourceParts.push(`${allocation}%`);

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
    document.getElementById('projectOwner').value = '';
    document.getElementById('projectStartDate').value = '';
    document.getElementById('projectStatus').value = 'Open';
    document.getElementById('projectSponsor').value = '';
    document.getElementById('projectDescription').value = '';
    document.getElementById('projectBudget').value = '';
    document.getElementById('projectLabels').value = '';
    document.getElementById('resourcesList').innerHTML = '';
    document.getElementById('stakeholdersList').innerHTML = '';

    let inResources = false;
    let inStakeholders = false;

    for (let line of lines) {
        line = line.trim();

        // Check for section headers
        if (line.toLowerCase() === 'resources:') {
            inResources = true;
            inStakeholders = false;
            continue;
        } else if (line.toLowerCase() === 'key stakeholders:' || line.toLowerCase() === 'stakeholders:') {
            inStakeholders = true;
            inResources = false;
            continue;
        } else if (line.match(/^[a-z\s]+:/i) && !line.startsWith('-')) {
            // New section, stop parsing resources/stakeholders
            inResources = false;
            inStakeholders = false;
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
        if (match && !inResources && !inStakeholders) {
            const key = match[1].trim().toLowerCase();
            const value = match[2].trim();

            switch (key) {
                case 'title':
                    document.getElementById('projectTitle').value = value;
                    break;
                case 'project manager':
                case 'project owner':
                case 'owner':
                    document.getElementById('projectOwner').value = value;
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
            }
        }
    }
}

function clearProjectDetailsForm() {
    document.getElementById('projectTitle').value = '';
    document.getElementById('projectOwner').value = '';
    document.getElementById('projectStartDate').value = '';
    document.getElementById('projectStatus').value = 'Open';
    document.getElementById('projectSponsor').value = '';
    document.getElementById('projectDescription').value = '';
    document.getElementById('projectBudget').value = '';
    document.getElementById('projectLabels').value = '';
    document.getElementById('resourcesList').innerHTML = '';
    document.getElementById('stakeholdersList').innerHTML = '';
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
let projectDetailsDebounceTimer = null;

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

    // Extract existing Resources, Key Stakeholders, and Formatting sections from current editor
    // to preserve any changes made via resource form or conditional formatting
    const existingResourcesSection = extractFrontMatterSection(content, 'Resources');
    const existingStakeholdersSection = extractFrontMatterSection(content, 'Key Stakeholders');
    const existingFormattingSection = extractFrontMatterSection(content, 'Formatting');

    // Collect form data
    const title = document.getElementById('projectTitle').value.trim();
    const owner = document.getElementById('projectOwner').value.trim();
    const startDate = document.getElementById('projectStartDate').value.trim();
    const status = document.getElementById('projectStatus').value;
    const sponsor = document.getElementById('projectSponsor').value.trim();
    const description = document.getElementById('projectDescription').value.trim();
    const budget = document.getElementById('projectBudget').value.trim();
    const labelsInput = document.getElementById('projectLabels').value.trim();

    // Build front matter
    let frontMatter = '---\n';
    if (title) frontMatter += `title: ${title}\n`;
    if (owner) frontMatter += `project manager: ${owner}\n`;
    if (startDate) frontMatter += `start date: ${startDate}\n`;
    if (status && status !== 'Open') frontMatter += `status: ${status}\n`;
    if (sponsor) frontMatter += `sponsor: ${sponsor}\n`;
    if (description) frontMatter += `description: ${description}\n`;
    if (budget) frontMatter += `budget: ${budget}\n`;
    if (labelsInput) frontMatter += `labels: [${labelsInput}]\n`;

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

        // Re-render timeline and gantt after width change
        setTimeout(() => {
            if (timelineTasks.length > 0) {
                updateTimeline(timelineTasks, timelineProjectName);
            }
            if (ganttTasks && ganttTasks.length > 0) {
                renderGanttChart();
            }
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

let conditionalFormattingRules = [];
let cfActivePickerRowIndex = null;

const CF_PASTEL_COLOURS = [
    '#FFE0B2', '#FFCCBC', '#F8BBD0', '#E1BEE7', '#D1C4E9',
    '#C5CAE9', '#BBDEFB', '#B3E5FC', '#B2EBF2', '#B2DFDB',
    '#C8E6C9', '#DCEDC8', '#F0F4C3', '#FFF9C4', '#FFECB3',
    '#D7CCC8', '#F5F5F5', '#CFD8DC'
];

const CF_DARK_COLOURS = [
    '#E65100', '#BF360C', '#880E4F', '#4A148C', '#311B92',
    '#1A237E', '#0D47A1', '#01579B', '#006064', '#004D40',
    '#1B5E20', '#33691E', '#827717', '#F57F17', '#FF6F00',
    '#3E2723', '#212121', '#263238'
];

function isPastelColour(colour) {
    const upper = colour.toUpperCase();
    return CF_PASTEL_COLOURS.includes(upper);
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
    return ['contains'];
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

    const fields = ['Task Name', 'Label', 'Start', 'Finish', '% Complete', 'Assigned To', 'Duration'];

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
    const fields = ['Task Name', 'Label', 'Start', 'Finish', '% Complete', 'Assigned To', 'Duration'];
    const conditions = ['contains', 'is before today', 'is after today', 'is before', 'is after', 'is less than', 'is more than', 'equals'];

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

let raidItems = [];
let raidNextId = 1;
let raidSortColumn = 'id';
let raidSortAsc = true;

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

    if (itemId !== null) {
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
        status: document.getElementById('raidItemStatus').value
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
        emptyState.style.display = 'block';
        document.getElementById('raidTable').style.display = 'none';
        return;
    }

    emptyState.style.display = 'none';
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
            <td><span class="raid-status-badge raid-status-${item.status || 'open'}">${item.status || 'open'}</span></td>
            <td>
                <button class="raid-action-btn" onclick="openRaidForm(${item.id})" title="Edit">✏️</button>
                <button class="raid-action-btn delete" onclick="deleteRaidItem(${item.id})" title="Delete">🗑️</button>
            </td>
        `;
        tbody.appendChild(row);
        } catch (itemError) {
            console.warn('Skipping malformed RAID item during render:', item, itemError);
        }
    });

    updateRaidSortIndicators();
    updateRaidMarkdownEditor();
    syncRaidLogToPlanText();
    } catch (error) {
        console.error('Error rendering RAID table:', error);
    }
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

    const headers = ['ID', 'Type', 'Title', 'Description', 'Raised By', 'Owner', 'Mitigation Actions', 'Impact', 'Likelihood', 'Score', 'Status'];

    const escPipe = (text) => String(text || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

    const rows = raidItems.map(item => [
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
            'date': 'date'
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
                    status: validStatuses.includes(itemStatus) ? itemStatus : 'open'
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
    return planText.substring(idx + marker.length).trim();
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

async function uploadRaidExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.xlsx')) {
        alert('Please select an Excel (.xlsx) file.');
        event.target.value = '';
        return;
    }

    try {
        const formData = new FormData();
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
        if (data.items.length === 0) {
            alert('No RAID items found in the Excel file.');
        } else {
            raidItems = data.items;
            raidNextId = Math.max(...data.items.map(i => i.id)) + 1;
            renderRaidTable();
        }
    } catch (error) {
        alert('Failed to import Excel: ' + error.message);
    }

    event.target.value = '';
}


/**
 * Interface Tour System
 */

const tourSteps = [
    {
        title: "Welcome to Noodle Planner! 🎉",
        message: "Let's take a quick tour to show you around. This will only take a minute!",
        target: null,
        position: "center"
    },
    {
        title: "Plan Editor",
        message: "This is where you write your project plan. Use a simple text format to create tasks, assign resources, set dates, and more.",
        target: ".editor-panel",
        position: "right"
    },
    {
        title: "Toolbar Actions",
        message: "Use these buttons to manage your project. Open Project Details, indent/outdent tasks, upload files, or download your plan.",
        target: ".editor-toolbar",
        position: "bottom"
    },
    {
        title: "Views Menu",
        message: "Click the Views dropdown to access different reports and visualizations: Project Report, Summary, Timeline, Gantt Chart, Resources, and more!",
        target: "#viewsTab",
        position: "bottom"
    },
    {
        title: "Board View",
        message: "Switch to the Board tab to see your tasks as Kanban cards. Drag and drop to organize by Phase, Resource, Progress, or Label.",
        target: ".tabs > .tab:nth-of-type(3)",
        position: "bottom",
        action: () => switchTab('kanban')
    },
    {
        title: "Collapsible Editor",
        message: "In Board view, you can collapse the editor for more space, or keep it open to edit while viewing your board.",
        target: "#kanbanEditorPanel",
        position: "right"
    },
    {
        title: "Planning Room 📋",
        message: "New! The Planning Room helps you create plans with a guided 3-stage workflow: Outline (YAML structure), Flow (visual dependencies), and Schedule (auto-generated plan.md). Perfect for complex projects!",
        target: ".tabs > .tab:nth-of-type(4)",
        position: "bottom"
    },
    {
        title: "Tracking Menu",
        message: "The Tracking dropdown gives you access to RAID Log (for tracking Risks, Actions, Issues, Decisions, Dependencies) and Highlights for project updates.",
        target: "#trackingTab",
        position: "bottom",
        action: () => switchTab('editor')
    },
    {
        title: "Resources Menu",
        message: "The Resources dropdown consolidates all resource views: Resources Table (with inline editing), Timesheet, User Workload, and the Resource Sheet for a timeline view of tasks by resource.",
        target: "#resourcesTab",
        position: "bottom"
    },
    {
        title: "Help & Resources",
        message: "Need help with the syntax? Check out the Help tab for examples and detailed instructions on how to use all features.",
        target: ".tabs > .tab:nth-of-type(5)",
        position: "bottom"
    },
    {
        title: "You're Ready! 🚀",
        message: "That's it! Start by creating your first task in the editor, explore the Views menu for different reports, or visit the Help tab to learn more.",
        target: null,
        position: "center"
    }
];

let currentTourStep = 0;

function startTour() {
    // Check if tour has been completed
    if (getCookie('tourCompleted') === 'true') {
        return;
    }

    currentTourStep = 0;
    showTourStep(0);
}

function showTourStep(stepIndex) {
    if (stepIndex >= tourSteps.length) {
        endTour();
        return;
    }

    const step = tourSteps[stepIndex];
    const overlay = document.getElementById('tourOverlay');
    const popup = document.getElementById('tourPopup');
    const spotlight = document.getElementById('tourSpotlight');
    const title = document.getElementById('tourTitle');
    const message = document.getElementById('tourMessage');
    const progress = document.getElementById('tourProgress');
    const nextBtn = document.getElementById('tourNext');

    // Execute step action if any
    if (step.action) {
        step.action();
    }

    // Show overlay
    overlay.classList.add('active');

    // Update content
    title.textContent = step.title;
    message.textContent = step.message;
    progress.textContent = `${stepIndex + 1} / ${tourSteps.length}`;

    // Update button text for last step
    if (stepIndex === tourSteps.length - 1) {
        nextBtn.textContent = 'Finish';
    } else {
        nextBtn.textContent = 'Next';
    }

    // Position spotlight and popup
    if (step.target) {
        const targetElement = document.querySelector(step.target);
        if (targetElement) {
            const rect = targetElement.getBoundingClientRect();

            // Position spotlight
            spotlight.style.left = rect.left - 10 + 'px';
            spotlight.style.top = rect.top - 10 + 'px';
            spotlight.style.width = rect.width + 20 + 'px';
            spotlight.style.height = rect.height + 20 + 'px';
            spotlight.style.display = 'block';

            // Position popup based on position hint
            positionPopup(popup, rect, step.position);
        }
    } else {
        // Center popup for non-targeted steps
        spotlight.style.display = 'none';
        popup.style.left = '50%';
        popup.style.top = '50%';
        popup.style.transform = 'translate(-50%, -50%)';
    }
}

function positionPopup(popup, targetRect, position) {
    const padding = 20;

    switch (position) {
        case 'right':
            popup.style.left = targetRect.right + padding + 'px';
            popup.style.top = targetRect.top + 'px';
            popup.style.transform = 'none';
            break;
        case 'left':
            popup.style.left = targetRect.left - popup.offsetWidth - padding + 'px';
            popup.style.top = targetRect.top + 'px';
            popup.style.transform = 'none';
            break;
        case 'bottom':
            popup.style.left = targetRect.left + 'px';
            popup.style.top = targetRect.bottom + padding + 'px';
            popup.style.transform = 'none';
            break;
        case 'top':
            popup.style.left = targetRect.left + 'px';
            popup.style.top = targetRect.top - popup.offsetHeight - padding + 'px';
            popup.style.transform = 'none';
            break;
        default:
            popup.style.left = '50%';
            popup.style.top = '50%';
            popup.style.transform = 'translate(-50%, -50%)';
    }
}

function nextTourStep() {
    currentTourStep++;
    showTourStep(currentTourStep);
}

function skipTour() {
    endTour();
}

function endTour() {
    const overlay = document.getElementById('tourOverlay');
    overlay.classList.remove('active');

    // Set cookie to remember tour completion (expires in 1 year)
    setCookie('tourCompleted', 'true', 365);
}

// Cookie helper functions
function setCookie(name, value, days) {
    const expires = new Date();
    expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = name + '=' + value + ';expires=' + expires.toUTCString() + ';path=/';
}

function getCookie(name) {
    const nameEQ = name + '=';
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}

// Initialize tour event listeners
document.addEventListener('DOMContentLoaded', function() {
    const nextBtn = document.getElementById('tourNext');
    const skipBtn = document.getElementById('tourSkip');

    if (nextBtn) {
        nextBtn.addEventListener('click', nextTourStep);
    }

    if (skipBtn) {
        skipBtn.addEventListener('click', skipTour);
    }

    // Start tour after a short delay to ensure everything is loaded
    setTimeout(() => {
        startTour();
    }, 1000);
});

/**
 * Check for tasks that don't have an explicitly set duration
 * Returns tasks that are missing duration, excluding:
 * - Summary tasks
 * - Tasks with explicitly set 0d duration (milestones)
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

        // 1. Check for resource shortname capitalization issues
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

        // 2. Check for missing resource names in front matter
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

        // 3. Check for missing stakeholders
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

        // 4. Check for missing front matter fields
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

        // 5. Check for tasks with missing durations (not explicitly set)
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

        // 6. Project health summary
        const healthScore = calculateHealthScore(insights);
        renderHealthScore(insightsContainer, healthScore);

        // Render all insights
        insights.forEach(insight => renderInsight(insightsContainer, insight));

        // Show success message if no issues
        if (insights.length === 0) {
            insightsContainer.innerHTML += '<div class="analysis-success"><h3>✓ Project Looks Good!</h3><p>No issues found. Your project plan is well-structured.</p></div>';
        }

    } catch (error) {
        console.error('Error updating analysis:', error);
    }
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

    lines.forEach((line, idx) => {
        const matches = line.match(/@(\w+)/g);
        if (matches) {
            matches.forEach(match => {
                const shortname = match.substring(1);
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
            const regex = new RegExp('@' + lowercase + '\\b', 'g');
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

// Toggle phases on timeline view
function toggleTimelinePhases() {
    // Re-render the timeline with current tasks
    if (timelineTasks && timelineTasks.length > 0) {
        updateTimeline(timelineTasks, timelineProjectName);
    }
}

// ===== Excel Import Wizard =====

function triggerExcelUpload() {
    const menu = document.getElementById('exportMenu');
    if (menu) menu.classList.remove('show');
    const input = document.getElementById('excelImportInput');
    input.value = '';
    input.onchange = function() {
        if (input.files && input.files[0]) {
            openExcelImportWizard(input.files[0]);
        }
    };
    input.click();
}

let excelWizardFile = null;
let excelWizardData = null;
let excelWizardStep = 1;

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

        // Filter overdue tasks (past due date, not complete)
        const overdueTasks = tasks.filter(task => {
            if (task.is_summary || !task.finish) return false;
            const finishDate = new Date(task.finish);
            finishDate.setHours(0, 0, 0, 0);
            const percentComplete = parseInt(task.percent) || 0;
            return finishDate < today && percentComplete < 100;
        });

        // Filter upcoming tasks (start or finish within next 2 weeks, not summary)
        const upcomingTasks = tasks.filter(task => {
            if (task.is_summary) return false;

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
        upcomingTasks.sort((a, b) => new Date(a.start || a.finish) - new Date(b.start || b.finish));

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

    // Task name with indentation
    const nameCell = document.createElement('td');
    const indent = '  '.repeat(task.level || 0);
    nameCell.textContent = indent + task.name;
    nameCell.style.fontFamily = 'monospace';
    nameCell.classList.add('task-level-' + (task.level || 0));
    row.appendChild(nameCell);

    if (type === 'overdue') {
        // Due date
        const dueDateCell = document.createElement('td');
        dueDateCell.textContent = task.finish ? new Date(task.finish).toLocaleDateString() : '-';
        row.appendChild(dueDateCell);

        // Days late
        const daysLateCell = document.createElement('td');
        if (task.finish && today) {
            const finishDate = new Date(task.finish);
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
        startCell.textContent = task.start ? new Date(task.start).toLocaleDateString() : '-';
        row.appendChild(startCell);

        // Due date
        const dueDateCell = document.createElement('td');
        dueDateCell.textContent = task.finish ? new Date(task.finish).toLocaleDateString() : '-';
        row.appendChild(dueDateCell);

        // Duration
        const durationCell = document.createElement('td');
        durationCell.textContent = task.duration_days ? `${task.duration_days}d` : '-';
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

    if (!sectionsContainer) return;

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

        // Parse holidays from front matter
        const holidays = [];
        if (frontMatter.holidays) {
            const holidayList = Array.isArray(frontMatter.holidays) ? frontMatter.holidays : [frontMatter.holidays];
            holidayList.forEach(h => {
                if (typeof h === 'string') holidays.push(h);
            });
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

// Helper function to get RAG color
function getRAGColor(rag) {
    if (!rag) return '#ccc';
    switch(rag.toUpperCase()) {
        case 'R': case 'RED': return '#d32f2f';
        case 'A': case 'AMBER': return '#f57c00';
        case 'G': case 'GREEN': return '#388e3c';
        default: return '#ccc';
    }
}

function getColumnMapping() {
    const fields = ['task_name', 'start_date', 'end_date', 'duration', 'resources', 'percent_complete', 'priority', 'bucket', 'comment'];
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

    const editor = document.getElementById('planEditor');
    editor.value = markdown;

    // Switch to editor tab
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    const editorTab = document.querySelector('[onclick*="editor"]');
    if (editorTab) editorTab.classList.add('active');
    document.getElementById('editor-tab').classList.add('active');

    editor.dispatchEvent(new Event('input'));

    closeExcelWizard();

    // Render the imported plan
    renderText();
}

/*
 * RAID Markdown Editor
 */
let raidEditorIsUpdating = false;
let raidEditorDebounceTimer = null;

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
 * RAID Log Plan Sync
 * Persists RAID items as a markdown table at the bottom of the plan text.
 */

const RAID_LOG_START = '---raid log---';

/**
 * Generate a markdown table for the RAID log with auto-sized columns.
 * Each column is padded to the width of its widest entry.
 */
function generateRaidLogTable() {
    if (raidItems.length === 0) return '';

    const headers = ['Type', 'Description', 'Status', 'Score', 'Owner', 'Date'];
    const escPipe = (text) => String(text || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

    const today = new Date().toISOString().slice(0, 10);
    const rows = raidItems.map(item => [
        escPipe(item.type),
        escPipe(item.title),
        escPipe(item.status),
        escPipe(String(item.score)),
        escPipe(item.owner),
        escPipe(item.date || today)
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
        editor.value = updatedText;
        updateLineNumbers();
        const kanbanEditor = document.getElementById('kanbanPlanEditor');
        if (kanbanEditor) {
            kanbanEditor.value = updatedText;
        }
        renderText();
    }
}

/**
 * Update plan text with RAID log section.
 * JavaScript equivalent of the Python update_plan_raid_log function.
 */
function updatePlanRaidLogText(planText, items) {
    // Strip existing RAID log section
    let base = planText;
    const startIdx = base.indexOf(RAID_LOG_START);
    if (startIdx !== -1) {
        base = base.substring(0, startIdx).replace(/\n+$/, '');
    }
    base = base.replace(/\n+$/, '');

    const table = generateRaidLogTable();
    if (!table) return base;

    return base + '\n\n' + RAID_LOG_START + '\n' + table;
}


/**
 * Highlights System
 * Project highlights / reporting entries stored in the plan text.
 */

let highlightsData = [];

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
    clearHighlights();
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

    const startIdx = text.indexOf(HIGHLIGHTS_START);
    if (startIdx === -1) return [];

    const afterStart = startIdx + HIGHLIGHTS_START.length;

    // Find the end: explicit end marker, raid log section, or EOF
    let endIdx = text.length;
    for (const marker of [HIGHLIGHTS_END, RAID_LOG_START_MARKER]) {
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
        if (emptyState) emptyState.style.display = 'block';
        return;
    }
    if (emptyState) emptyState.style.display = 'none';

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
                    <button class="highlight-action-btn" onclick="editHighlight(${originalIdx})" title="Edit">&#9998;</button>
                    <button class="highlight-action-btn delete" onclick="deleteHighlight(${originalIdx})" title="Delete">&#128465;</button>
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
        editor.value = updatedText;
        updateLineNumbers();
        // Sync to kanban editor if it exists
        const kanbanEditor = document.getElementById('kanbanPlanEditor');
        if (kanbanEditor) {
            kanbanEditor.value = updatedText;
        }
        // Trigger a re-render so the backend parses the updated plan text
        // and all views (including highlights) stay in sync.
        await renderText();
    }
}

/**
 * Update plan text with highlights section.
 * JavaScript equivalent of the Python update_plan_highlights function.
 */
function updatePlanHighlightsText(planText, highlights) {
    const HIGHLIGHTS_START = '---highlights---';
    const END_MARKERS = ['---end-highlights---', '---raid log---'];

    // Separate RAID log section if present (preserve it)
    let raidLogSuffix = '';
    const raidLogIdx = planText.indexOf(RAID_LOG_START);
    if (raidLogIdx !== -1) {
        raidLogSuffix = '\n\n' + planText.substring(raidLogIdx);
    }

    // Strip existing highlights section
    let base = planText;
    const startIdx = base.indexOf(HIGHLIGHTS_START);
    if (startIdx !== -1) {
        const afterStart = startIdx + HIGHLIGHTS_START.length;

        // Find the end: explicit end marker, raid log section, or EOF
        let endIdx = base.length;
        let endLen = 0;
        for (const marker of END_MARKERS) {
            const idx = base.indexOf(marker, afterStart);
            if (idx !== -1 && idx < endIdx) {
                endIdx = idx;
                endLen = marker.length;
            }
        }

        const before = base.substring(0, startIdx).replace(/\n+$/, '');
        const after = base.substring(endIdx + endLen).replace(/^\n+/, '');
        base = after ? before + '\n' + after : before;
    }
    base = base.replace(/\n+$/, '');

    // Remove trailing --- separator that preceded the highlights section
    let lines = base.split('\n');
    while (lines.length > 0 && lines[lines.length - 1].trim() === '---') {
        lines.pop();
    }
    base = lines.join('\n').replace(/\n+$/, '');

    // Also strip any RAID log content that leaked into base
    const baseRaidIdx = base.indexOf(RAID_LOG_START);
    if (baseRaidIdx !== -1) {
        base = base.substring(0, baseRaidIdx).replace(/\n+$/, '');
    }

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
        section += '\n\n---end-highlights---';
        result = base + '\n\n---\n\n' + section;
    }

    // Re-append RAID log if it was present
    if (raidLogSuffix) {
        result = result.replace(/\n+$/, '') + raidLogSuffix;
    }

    return result;
}

