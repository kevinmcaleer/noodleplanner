let selectedFile = null;
let renderTimeout = null;
let globalResourceMap = {}; // Maps shortnames to full names from backend

// Track which section the resource form was opened from (for returning to it)
let resourceFormReturnSection = null;

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
        for (let i = 0; i < allLines.length; i++) {
            const trimmed = allLines[i].trim();
            if (trimmed === '---') {
                inFrontMatter = !inFrontMatter;
                continue;
            }
            if (trimmed === '---highlights---') { inHighlights = true; continue; }
            if (trimmed === '---end-highlights---' || (inHighlights && trimmed === '---raid---')) { inHighlights = false; continue; }
            if (inFrontMatter || inHighlights || !trimmed || trimmed.startsWith('#') || trimmed.includes('===')) continue;

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
        return allLines.map(line => {
            // Track highlights section boundaries
            if (line.trim() === '---highlights---') {
                inHighlightsSection = true;
                return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            if (line.trim() === '---end-highlights---' || (inHighlightsSection && line.trim() === '---raid---')) {
                inHighlightsSection = false;
                return '<span class="syntax-highlights-delimiter">' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
            }
            // Dim lines inside highlights section
            if (inHighlightsSection) {
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
            return;
        }

        const result = await response.json();

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
        console.log('Received resource_map from backend:', result.resource_map);
        console.log('Set globalResourceMap to:', globalResourceMap);
        console.log('globalResourceMap keys:', Object.keys(globalResourceMap));
        console.log('globalResourceMap entries:', JSON.stringify(Object.entries(globalResourceMap)));
        // Log each entry individually
        for (const [key, value] of Object.entries(globalResourceMap)) {
            console.log(`  Resource mapping: "${key}" -> "${value}"`);
        }

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

        // Update Gantt Chart
        updateGantt(result.tasks || []);

        // Update Analysis (pass planText directly since front_matter might be an object)
        updateAnalysis(planText, result.tasks || [], planText, result.resource_map || {});

        // Update Highlights
        updateHighlightsView(result.highlights || []);

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

        // Most recent highlight is the last in the array
        const latest = highlightsData[highlightsData.length - 1];

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
        console.log('Building reverse lookup from globalResourceMap:', globalResourceMap);
        Object.keys(globalResourceMap).forEach(shortname => {
            const fullName = globalResourceMap[shortname];
            if (fullName) {
                fullNameToShortname[fullName.toLowerCase()] = shortname;
                console.log('Mapped:', fullName.toLowerCase(), '->', shortname);
            }
        });
        console.log('Final fullNameToShortname map:', fullNameToShortname);

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
                    console.log('Resource:', resource, '-> shortname:', shortname, '(from lookup:', resource.toLowerCase(), ')');

                    resourceData[resource] = {
                        name: resource,
                        shortname: shortname, // Store shortname for form population
                        taskCount: 0,
                        totalDays: 0,
                        totalHours: 0
                    };
                }

                resourceData[resource].taskCount++;
                resourceData[resource].totalDays += task.duration_days || 0;
                resourceData[resource].totalHours += (task.duration_days || 0) * 8; // Assuming 8 hour work days
            });
        });

        // Convert to array and sort by name
        const sortedResources = Object.values(resourceData).sort((a, b) =>
            a.name.localeCompare(b.name)
        );

        // Populate table rows
        sortedResources.forEach(resource => {
            const row = document.createElement('tr');

            // Resource Name cell
            const nameCell = document.createElement('td');
            nameCell.textContent = resource.name;
            nameCell.classList.add('resource-name');
            nameCell.style.cursor = 'pointer';
            nameCell.addEventListener('dblclick', () => {
                // Use the stored shortname for form population
                const shortname = resource.shortname || resource.name.replace(/^@/, '');
                console.log('Opening resource form for:', shortname, 'from resource.name:', resource.name, 'shortname:', resource.shortname);
                openResourceForm(shortname);
            });
            row.appendChild(nameCell);

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
        const headerRow = document.getElementById('timesheetHeaderRow');
        const tbody = document.getElementById('timesheetBody');
        if (!headerRow || !tbody) {
            console.error('Timesheet table elements not found');
            return;
        }

        // Clear existing content
        // Keep the first header cell (Resource), remove date columns
        while (headerRow.children.length > 1) {
            headerRow.removeChild(headerRow.lastChild);
        }
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
        while (currentDate <= maxDate) {
            dates.push(new Date(currentDate));
            currentDate.setDate(currentDate.getDate() + 1);
        }

        // Add date header columns with format "Mon 03 may"
        dates.forEach(date => {
            const th = document.createElement('th');
            th.className = 'timesheet-date-col';
            const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'short' });
            const day = String(date.getDate()).padStart(2, '0');
            const month = date.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
            th.textContent = `${dayOfWeek} ${day} ${month}`;

            // Add weekend class for Saturdays and Sundays
            const dayOfWeekNum = date.getDay();
            if (dayOfWeekNum === 0 || dayOfWeekNum === 6) {
                th.classList.add('timesheet-weekend');
            }

            // Add holiday class if applicable
            const dateKey = date.toISOString().split('T')[0];
            if (holidays.includes(dateKey)) {
                th.classList.add('timesheet-holiday');
            }

            headerRow.appendChild(th);
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

function renderMinimalTimeline(container, tasks, minDate, maxDate, totalDays, timelineWidth, options) {
    const isReport = options?.isReport ?? false;
    const timelineLineId = isReport ? 'reportTimelineLine' : 'timelineLine';
    const milestonesId = isReport ? 'reportTimelineMilestones' : 'timelineMilestones';

    const timelineLine = document.getElementById(timelineLineId);
    const timelineMilestones = document.getElementById(milestonesId);

    if (!timelineLine || !timelineMilestones) return;

    // Clear existing content
    timelineMilestones.innerHTML = '';
    timelineLine.querySelectorAll('.timeline-progress, .timeline-date-label, .timeline-scale').forEach(el => el.remove());

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

    // Get milestones (0-duration, non-summary)
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

            // Add tooltip
            const title = document.createElementNS(svgNS, 'title');
            title.textContent = phase.name + ' (' + percent + '% complete)';
            rect.appendChild(title);

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
                svg.appendChild(progressRect);
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

    // Hide the main timeline line in minimal mode (we use the phase bars instead)
    timelineLine.style.display = 'none';

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

        milestoneDiv.appendChild(marker);
        timelineMilestones.appendChild(milestoneDiv);
    });

    // Add date scale in small font
    addMinimalDateScale(container, minDate, maxDate, totalDays, timelineWidth);
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

    // Add start and end date labels
    const startLabel = document.createElement('span');
    startLabel.className = 'minimal-date-label';
    startLabel.style.left = '0';
    startLabel.textContent = minDate.toISOString().split('T')[0];
    scaleDiv.appendChild(startLabel);

    markers.forEach(marker => {
        const markerSpan = document.createElement('span');
        markerSpan.className = 'minimal-date-label minimal-date-tick';
        markerSpan.style.left = marker.position + 'px';
        markerSpan.textContent = marker.label;
        scaleDiv.appendChild(markerSpan);
    });

    const endLabel = document.createElement('span');
    endLabel.className = 'minimal-date-label';
    endLabel.style.right = '0';
    endLabel.style.left = 'auto';
    endLabel.textContent = maxDate.toISOString().split('T')[0];
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
            if (timelineLineEl) timelineLineEl.style.display = '';
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

    ganttTasks.forEach((task, index) => {
        // Info row
        const infoRow = document.createElement('tr');
        infoRow.dataset.taskIndex = index;
        if (task.is_summary) {
            infoRow.classList.add('gantt-phase-row');
        }

        // ID cell (not editable)
        const idCell = document.createElement('td');
        idCell.textContent = task.id;
        infoRow.appendChild(idCell);

        // Task Name cell (editable)
        const nameCell = document.createElement('td');
        nameCell.classList.add('editable');
        nameCell.dataset.field = 'name';
        const indent = '  '.repeat(task.level);
        nameCell.textContent = indent + task.name;
        nameCell.style.fontFamily = "'Courier New', monospace";
        nameCell.style.whiteSpace = 'pre';
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
        percentCell.textContent = task.percent || '-';
        percentCell.addEventListener('dblclick', () => makeEditable(percentCell, task, index));
        infoRow.appendChild(percentCell);

        // Comment cell (editable)
        const commentCell = document.createElement('td');
        commentCell.classList.add('editable');
        commentCell.dataset.field = 'comment';
        commentCell.textContent = task.comment || '-';
        commentCell.addEventListener('dblclick', () => makeEditable(commentCell, task, index));
        infoRow.appendChild(commentCell);

        ganttInfoBody.appendChild(infoRow);

        // Gantt bar row
        const barRow = document.createElement('div');
        barRow.className = 'gantt-bar-row';
        barRow.style.minWidth = totalWidth + 'px';
        barRow.dataset.taskIndex = index;

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

            // Calculate task duration in days by counting (inclusive of both start and end day)
            let taskDuration = 1; // Start day counts as 1
            tempDate = new Date(taskStart);
            while (tempDate < taskFinish) {
                tempDate.setDate(tempDate.getDate() + 1);
                taskDuration++;
            }

            const bar = document.createElement('div');
            bar.className = task.is_summary ? 'gantt-bar gantt-phase-bar' : 'gantt-bar gantt-task-bar';
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

            // Add drag event listeners
            setupBarDragListeners(bar, task, index);

            barRow.appendChild(bar);
        }

        ganttInfoBody.appendChild(infoRow);
        ganttBody.appendChild(barRow);
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
        currentValue = task.percent ? task.percent.replace('%', '') : '';
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
            } else {
                // Original fields: name, resources, comment
                // For name field, save the old name before updating
                const oldName = field === 'name' ? task.name : null;

                task[field] = newValue;
                ganttTasks[taskIndex][field] = newValue;
                syncGanttEditToEditor(task, taskIndex, field, newValue, oldName);

                // Update cell display
                if (field === 'name') {
                    const indent = '  '.repeat(task.level);
                    cell.textContent = indent + newValue;
                } else {
                    cell.textContent = newValue || '-';
                }
            }
        } else {
            // No change - restore original content
            cell.textContent = originalContent;
        }
    };

    input.addEventListener('blur', saveEdit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            saveEdit();
        } else if (e.key === 'Escape') {
            cell.classList.remove('editing');
            cell.textContent = originalContent;
        }
    });
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

    // Count days from start to finish (inclusive)
    let taskDuration = 1; // Start day counts as 1
    let tempDate = new Date(newStartDate);
    while (tempDate < newFinishDate) {
        tempDate.setDate(tempDate.getDate() + 1);
        taskDuration++;
    }

    task.duration_days = taskDuration;
    ganttTasks[taskIndex].duration_days = task.duration_days;

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
    // This is a simplified version - may need more robust matching
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const indent = '  '.repeat(task.level);
        const taskNamePattern = new RegExp(`^${indent}${searchName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

        if (taskNamePattern.test(line)) {
            // Update the field in the line
            if (field === 'name') {
                // Replace task name (preserve rest of line)
                // Use searchName length (the old name) to correctly extract the rest of the line
                const rest = line.substring(indent.length + searchName.length);
                lines[i] = indent + newValue + rest;
            } else if (field === 'resources') {
                // Update resources - need to find and replace resource pattern
                const resourcePattern = /\[([^\]]+)\]/;
                if (newValue) {
                    if (resourcePattern.test(line)) {
                        lines[i] = line.replace(resourcePattern, `[${newValue}]`);
                    } else {
                        // Add resources if not present
                        lines[i] = line.trim() + ` [${newValue}]`;
                    }
                } else {
                    // Remove resources
                    lines[i] = line.replace(resourcePattern, '').trim();
                }
            } else if (field === 'comment') {
                // Update comment - need to find and replace comment pattern
                const commentPattern = /\{([^}]*)\}/;
                if (newValue) {
                    if (commentPattern.test(line)) {
                        lines[i] = line.replace(commentPattern, `{${newValue}}`);
                    } else {
                        // Add comment if not present
                        lines[i] = line.trim() + ` {${newValue}}`;
                    }
                } else {
                    // Remove comment
                    lines[i] = line.replace(commentPattern, '').trim();
                }
            }

            // Update editor
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
        this.dependencies = [];
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

        // Extract dependencies (after #)
        const depMatch = remaining.match(/#([^\\s@%!"]+)/);
        if (depMatch) {
            this.dependencies = depMatch[1].split(',').map(d => d.trim());
        }

        // Extract comment (text in quotes)
        const commentMatch = remaining.match(/"([^"]*)"/);
        if (commentMatch) {
            this.comment = commentMatch[1];
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

        // Add non-previous dependencies
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
            line += ' #' + nonPrevDeps.join(',');
        }

        // Add percent
        if (this.percent > 0) {
            line += ' ' + this.percent + '%';
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
        checkbox.className = 'subtask-checkbox';
        checkbox.checked = parseInt(subtask.percent) === 100;
        checkbox.addEventListener('change', () => toggleSubtaskCompletion(subtask.lineNumber, checkbox.checked));

        const label = document.createElement('span');
        label.className = 'subtask-label';
        label.textContent = subtask.name;
        label.addEventListener('click', () => {
            // Close current form and open subtask form
            closeTaskForm();
            setTimeout(() => openTaskForm(subtask.lineNumber), 100);
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
    checkbox.className = 'subtask-checkbox';
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
});

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

    // Extract existing Resources and Key Stakeholders sections from current editor
    // to preserve any changes made via resource form
    const existingResourcesSection = extractFrontMatterSection(content, 'Resources');
    const existingStakeholdersSection = extractFrontMatterSection(content, 'Key Stakeholders');

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
 * RAID Log System
 * Tracks Risks, Actions, Issues, Decisions, and Dependencies
 */

let raidItems = [];
let raidNextId = 1;
let raidSortColumn = 'id';
let raidSortAsc = true;

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
}

function deleteRaidItem(id) {
    if (!confirm('Are you sure you want to delete this RAID item?')) return;
    raidItems = raidItems.filter(i => i.id !== id);
    renderRaidTable();
}

function renderRaidTable() {
    const tbody = document.getElementById('raidTableBody');
    const emptyState = document.getElementById('raidEmptyState');
    const filterType = document.getElementById('raidFilterType').value;
    const filterStatus = document.getElementById('raidFilterStatus').value;

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
        const row = document.createElement('tr');

        const scoreClass = item.score >= 16 ? 'raid-score-high' : item.score >= 6 ? 'raid-score-medium' : 'raid-score-low';

        row.innerHTML = `
            <td>${item.id}</td>
            <td><span class="raid-type-badge raid-type-${item.type}">${item.type}</span></td>
            <td title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</td>
            <td title="${escapeHtml(item.description)}">${escapeHtml(item.description)}</td>
            <td>${escapeHtml(item.raised_by)}</td>
            <td>${escapeHtml(item.owner)}</td>
            <td title="${escapeHtml(item.mitigation_actions)}">${escapeHtml(item.mitigation_actions)}</td>
            <td>${item.impact}</td>
            <td>${item.likelihood}</td>
            <td><span class="raid-score ${scoreClass}">${item.score}</span></td>
            <td><span class="raid-status-badge raid-status-${item.status}">${item.status}</span></td>
            <td>
                <button class="raid-action-btn" onclick="openRaidForm(${item.id})" title="Edit">✏️</button>
                <button class="raid-action-btn delete" onclick="deleteRaidItem(${item.id})" title="Delete">🗑️</button>
            </td>
        `;
        tbody.appendChild(row);
    });

    updateRaidSortIndicators();
    updateRaidMarkdownEditor();
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
    const separator = headers.map(() => '---');

    const escPipe = (text) => String(text || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

    const rows = raidItems.map(item => [
        item.id,
        item.type.charAt(0).toUpperCase() + item.type.slice(1),
        escPipe(item.title),
        escPipe(item.description),
        escPipe(item.raised_by),
        escPipe(item.owner),
        escPipe(item.mitigation_actions),
        item.impact,
        item.likelihood,
        item.score,
        item.status.charAt(0).toUpperCase() + item.status.slice(1)
    ]);

    let md = '# RAID Log\n\n';
    md += '| ' + headers.join(' | ') + ' |\n';
    md += '| ' + separator.join(' | ') + ' |\n';
    rows.forEach(row => {
        md += '| ' + row.join(' | ') + ' |\n';
    });

    return md;
}

function parseRaidMarkdown(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    let headerIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('|') && lines[i].toLowerCase().includes('id') && lines[i].toLowerCase().includes('title')) {
            headerIndex = i;
            break;
        }
    }

    if (headerIndex === -1) return [];

    const parseRow = (line) => {
        return line.split('|').map(cell => cell.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length);
    };

    const headers = parseRow(lines[headerIndex]).map(h => h.toLowerCase());

    const colMap = {};
    const fieldAliases = {
        'id': 'id', 'type': 'type', 'title': 'title',
        'description': 'description', 'raised by': 'raised_by',
        'owner': 'owner', 'mitigation actions': 'mitigation_actions',
        'impact': 'impact', 'likelihood': 'likelihood',
        'score': 'score', 'status': 'status'
    };

    headers.forEach((h, idx) => {
        for (const [alias, field] of Object.entries(fieldAliases)) {
            if (h.includes(alias)) {
                colMap[field] = idx;
                break;
            }
        }
    });

    const items = [];
    const validTypes = ['risk', 'action', 'issue', 'decision', 'dependency'];
    const validStatuses = ['open', 'closed', 'transferred'];

    for (let i = headerIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes('|')) continue;
        if (line.replace(/[|\-\s]/g, '').length === 0) continue;

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

        const impact = Math.max(1, Math.min(5, parseInt(getCell('impact', '3')) || 3));
        const likelihood = Math.max(1, Math.min(5, parseInt(getCell('likelihood', '3')) || 3));

        items.push({
            id: parseInt(getCell('id', items.length + 1)) || items.length + 1,
            type: validTypes.includes(itemType) ? itemType : 'risk',
            title: getCell('title', ''),
            description: getCell('description', ''),
            raised_by: getCell('raised_by', ''),
            owner: getCell('owner', ''),
            mitigation_actions: getCell('mitigation_actions', ''),
            impact: impact,
            likelihood: likelihood,
            score: impact * likelihood,
            status: validStatuses.includes(itemStatus) ? itemStatus : 'open'
        });
    }

    return items;
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
        title: "Kanban Board",
        message: "Switch to the Kanban tab to see your tasks as cards. Drag and drop to organize by Phase, Resource, Progress, or Label.",
        target: ".tab:nth-child(2)",
        position: "bottom",
        action: () => switchTab('kanban')
    },
    {
        title: "Collapsible Editor",
        message: "In Kanban view, you can collapse the editor for more space, or keep it open to edit while viewing your board.",
        target: "#kanbanEditorPanel",
        position: "right"
    },
    {
        title: "Syntax Guide",
        message: "Need help with the syntax? Check out the Syntax Guide tab for examples and detailed instructions.",
        target: ".tab:nth-child(3)",
        position: "bottom"
    },
    {
        title: "RAID Log",
        message: "Track project Risks, Actions, Issues, Decisions, and Dependencies. Download as markdown or Excel, and upload files to continue editing.",
        target: ".tab:nth-child(4)",
        position: "bottom",
        action: () => switchTab('raid')
    },
    {
        title: "You're Ready! 🚀",
        message: "That's it! Start by creating your first task in the editor, or visit the Syntax Guide to learn more about all the features.",
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

function getColumnMapping() {
    const fields = ['task_name', 'start_date', 'end_date', 'duration', 'resources', 'percent_complete', 'comment'];
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


/**
 * Highlights System
 * Project highlights / reporting entries stored in the plan text.
 */

let highlightsData = [];

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
function syncHighlightsToPlanText() {
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
        renderText();
    }
}

/**
 * Update plan text with highlights section.
 * JavaScript equivalent of the Python update_plan_highlights function.
 */
function updatePlanHighlightsText(planText, highlights) {
    const HIGHLIGHTS_START = '---highlights---';
    const END_MARKERS = ['---end-highlights---', '---raid---'];

    // Strip existing highlights section
    let base = planText;
    const startIdx = base.indexOf(HIGHLIGHTS_START);
    if (startIdx !== -1) {
        const afterStart = startIdx + HIGHLIGHTS_START.length;

        // Find the end: explicit end marker, raid section, or EOF
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

    // Generate new highlights section
    if (!highlights || highlights.length === 0) {
        return base;
    }

    let section = HIGHLIGHTS_START + '\n';
    highlights.forEach(h => {
        section += `## ${h.date} @${h.author}\n`;
        section += (h.content || '').replace(/\n+$/, '') + '\n\n';
    });
    section = section.replace(/\n+$/, '');

    return base + '\n\n---\n\n' + section;
}
