/**
 * editor.js — Editor setup, syntax highlighting, line numbers, drag-drop.
 * Depends on: state.js (globals)
 */

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
        let inBaseline = false;
        let inBudget = false;
        for (let i = 0; i < allLines.length; i++) {
            const trimmed = allLines[i].trim();
            if (trimmed === '---') {
                inFrontMatter = !inFrontMatter;
                continue;
            }
            if (trimmed === '---highlights---') { inHighlights = true; continue; }
            if (trimmed === '---end-highlights---' || (inHighlights && (trimmed === '---raid log---' || trimmed === '---budget---'))) { inHighlights = false; }
            if (trimmed === '---budget---') { inBudget = true; continue; }
            if (inBudget && (trimmed === '---raid log---')) { inBudget = false; }
            if (trimmed === '---raid log---') { inRaidLog = true; continue; }
            if (trimmed === '---baseline---') { inBaseline = true; continue; }
            if (inFrontMatter || inHighlights || inRaidLog || inBaseline || inBudget || !trimmed || trimmed.startsWith('#') || trimmed.includes('===')) continue;

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
            if (name) allTaskNames.add(name.toLowerCase());
        }

        let inHighlightsSection = false;
        let inBudgetSection = false;
        let inRaidLogSection = false;
        let inBaselineSection = false;
        return allLines.map(line => {
            // Track highlights section boundaries
            if (line.trim() === '---highlights---') {
                inHighlightsSection = true;
                return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            if (line.trim() === '---end-highlights---' || (inHighlightsSection && (line.trim() === '---raid log---' || line.trim() === '---budget---'))) {
                inHighlightsSection = false;
                if (line.trim() === '---budget---') {
                    inBudgetSection = true;
                    return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
                }
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
            // Track budget section
            if (line.trim() === '---budget---') {
                inBudgetSection = true;
                return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            // Dim lines inside budget section
            if (inBudgetSection) {
                if (line.trim() === '---raid log---') {
                    inBudgetSection = false;
                    inRaidLogSection = true;
                    return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
                }
                if (line.trim() === '---baseline---') {
                    inBudgetSection = false;
                    inBaselineSection = true;
                    return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
                }
                return '<span class="syntax-highlights-content">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            // Track RAID log section
            if (line.trim() === '---raid log---') {
                inRaidLogSection = true;
                return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            // Dim lines inside RAID log section
            if (inRaidLogSection) {
                // Check if we've entered the baseline section
                if (line.trim() === '---baseline---') {
                    inRaidLogSection = false;
                    inBaselineSection = true;
                    return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
                }
                return '<span class="syntax-highlights-content">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            // Track baseline section
            if (line.trim() === '---baseline---') {
                inBaselineSection = true;
                return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            // Dim lines inside baseline section
            if (inBaselineSection) {
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
            // (e.g., [depends Task1, Task2:SS +2d])
            highlighted = highlighted.replace(/\[depends\s+([^\]]+)\]/gi, (match, deps) => {
                // Split dependencies and validate each one
                const depParts = deps.split(',').map(d => d.trim()).filter(d => d);
                const highlightedParts = depParts.map(dep => {
                    // Strip lag/lead to get the core part
                    const lagLeadMatch = dep.match(/^(.+?)\s+([+\-]\d+[dwmy])$/);
                    let corePart = lagLeadMatch ? lagLeadMatch[1].trim() : dep.trim();
                    const lagLeadPart = lagLeadMatch ? ' <span class="syntax-lag-lead">' + lagLeadMatch[2] + '</span>' : '';

                    // Strip dependency type suffix (:FS, :SS, :FF, :SF)
                    const typeMatch = corePart.match(/^(.+?):(FS|SS|FF|SF)$/i);
                    const depTaskName = typeMatch ? typeMatch[1].trim() : corePart;
                    const typePart = typeMatch ? '<span class="syntax-dep-type">:' + typeMatch[2].toUpperCase() + '</span>' : '';

                    // Check if the dependency task name exists
                    const isValid = allTaskNames.has(depTaskName.toLowerCase());
                    if (isValid) {
                        return depTaskName + typePart + lagLeadPart;
                    } else {
                        return '<span class="syntax-error">' + depTaskName + '</span>' + typePart + lagLeadPart;
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
    // Inner wrapper for line numbers — positioned via CSS top for scroll sync
    function updateLineNumbers() {
        const content = editor.value || editor.placeholder || '';
        const lines = content.split('\n');
        const lineCount = lines.length;

        // Create line number elements
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
            highlightLayer.innerHTML = highlightSyntax(content);
        }

        // Sync positions
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

    // Sync scroll between textarea, line numbers, and highlight overlay.
    // Uses CSS top/left offset instead of scrollTop to avoid line-height
    // drift between textarea and div text rendering.
    function syncScroll() {
        if (highlightLayer) {
            highlightLayer.style.top = -editor.scrollTop + 'px';
            highlightLayer.style.left = -editor.scrollLeft + 'px';
        }
        lineNumbers.scrollTop = editor.scrollTop;
    }

    // Expose updateLineNumbers on the editor element so external code can call it
    editor._updateLineNumbers = updateLineNumbers;

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

            // Record undo snapshot (debounced) for the main editor
            if (typeof EditorUndoManager !== 'undefined') {
                EditorUndoManager.scheduleSnapshot(editor.value);
            }

            // Auto-render after 1 second of inactivity
            renderDebounceTimer = setTimeout(() => {
                renderText();
                renderDebounceTimer = null;
            }, 1000);
        }
    });

    // Sync scroll on all scroll-related events including touch momentum
    editor.addEventListener('scroll', syncScroll, { passive: true });
    editor.addEventListener('touchmove', syncScroll, { passive: true });

    // Track cursor position for active line indicator
    editor.addEventListener('click', updateActiveLine);
    editor.addEventListener('keyup', updateActiveLine);
    editor.addEventListener('focus', updateActiveLine);
    editor.addEventListener('touchend', updateActiveLine);

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

    // Capture undo snapshot before the change
    if (editor === mainEditor && typeof EditorUndoManager !== 'undefined') {
        EditorUndoManager.captureImmediate(editor.value);
    }

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

    // Capture undo snapshot before the change
    if (editor === mainEditor && typeof EditorUndoManager !== 'undefined') {
        EditorUndoManager.captureImmediate(editor.value);
    }

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
 * Add a dependency to a line using the * prefix approach.
 * Prepends * before the task name to indicate dependency on the previous task.
 */
function addStarDependencyToLine(line) {
    const indent = line.match(/^\s*/)[0];
    const trimmed = line.trimStart();
    if (trimmed.startsWith('*')) {
        return line; // Already has * prefix
    }
    return indent + '*' + trimmed;
}

/**
 * Check whether a task line already has any dependency
 * (either a * prefix or a [depends ...] block).
 */
function lineHasDependency(line) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('*')) return true;
    if (/\[depends\s+[^\]]+\]/i.test(line)) return true;
    return false;
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

    // Capture undo snapshot before the change
    if (editor === mainEditor && typeof EditorUndoManager !== 'undefined') {
        EditorUndoManager.captureImmediate(editor.value);
    }

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

    // Chain each task to depend on the previous one.
    // Use * prefix when the task has no existing dependencies (single dep).
    // Use [depends taskname] when the task already has dependencies (multiple deps).
    for (let i = 1; i < taskEntries.length; i++) {
        const prevTaskName = taskEntries[i - 1].name;
        const lineIndex = taskEntries[i].index;
        if (lineHasDependency(lines[lineIndex])) {
            lines[lineIndex] = addDependencyToLine(lines[lineIndex], prevTaskName);
        } else {
            lines[lineIndex] = addStarDependencyToLine(lines[lineIndex]);
        }
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

            // Check if it's a supported file type
            if (!file.name.match(/\.(md|txt|xlsx|xls)$/i)) {
                showMessage('editor', 'error', 'Please drop Markdown (.md), text (.txt), or Excel (.xlsx) files');
                return;
            }

            if (file.size > 1048576) {
                showMessage('editor', 'error', 'File size must be less than 1MB');
                return;
            }

            // Excel files go through the import wizard
            if (file.name.match(/\.(xlsx|xls)$/i)) {
                openExcelImportWizard(file);
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

        // Save current project before creating a new one
        saveCurrentProjectState();

        // Create a new project from the uploaded file
        const projectName = file.name.replace(/\.(md|txt|markdown)$/i, '');
        const project = createProject(projectName);
        saveProject(project.id, { planText: text });
        setCurrentProjectId(project.id);

        // Load content into editor
        planEditor.value = text;

        // Trigger input event to update line numbers and syntax highlighting
        planEditor.dispatchEvent(new Event('input'));

        // Update kanban editor too
        const kanbanEditor = document.getElementById('kanbanPlanEditor');
        if (kanbanEditor) {
            kanbanEditor.value = text;
        }

        // Refresh project selectors
        if (typeof refreshProjectSelectors === 'function') {
            refreshProjectSelectors();
        }

        // Show success message
        showMessage('editor', 'success', `Created project "${project.name}" from ${file.name}`);

        // Auto-render the plan
        await renderText();

        console.log(`Created project "${project.name}" from ${file.name}`);

    } catch (error) {
        console.error('Error loading file:', error);
        showMessage('editor', 'error', 'Failed to load file: ' + error.message);
    }
}

function initializeKanbanEditorDragDrop() {
    const kanbanEditorPanel = document.getElementById('kanbanEditorPanel');
    const kanbanEditor = document.getElementById('kanbanPlanEditor');

    if (!kanbanEditorPanel || !kanbanEditor) {
        return;
    }

    kanbanEditorPanel.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        kanbanEditorPanel.classList.add('drag-over');
    });

    kanbanEditorPanel.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!kanbanEditorPanel.contains(e.relatedTarget)) {
            kanbanEditorPanel.classList.remove('drag-over');
        }
    });

    kanbanEditorPanel.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        kanbanEditorPanel.classList.remove('drag-over');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];

            if (!file.name.match(/\.(md|txt|xlsx|xls)$/i)) {
                showMessage('editor', 'error', 'Please drop Markdown (.md), text (.txt), or Excel (.xlsx) files');
                return;
            }

            if (file.size > 1048576) {
                showMessage('editor', 'error', 'File size must be less than 1MB');
                return;
            }

            if (file.name.match(/\.(xlsx|xls)$/i)) {
                openExcelImportWizard(file);
                return;
            }

            handleEditorFileDrop(file);
        }
    });
}

