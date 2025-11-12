let selectedFile = null;
let renderTimeout = null;

function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    event.target.classList.add('active');
    document.getElementById(tabName + '-tab').classList.add('active');
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
        return text.split('\n').map(line => {
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

            // Highlight dependencies (e.g., [depends Task1, Task2])
            highlighted = highlighted.replace(/\[depends\s+([^\]]+)\]/gi, (match, deps) => {
                return savePlaceholder('<span class="syntax-dependency">[depends ' + deps + ']</span>');
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
            lineNumSpan.textContent = i;
            lineNumSpan.dataset.lineNumber = i;
            lineNumbers.appendChild(lineNumSpan);
        }

        // Update syntax highlighting
        if (highlightLayer) {
            const highlighted = highlightSyntax(content);
            highlightLayer.innerHTML = highlighted;
        }

        // Update active line indicator
        updateActiveLine();
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
    if (!file.name.match(/\.(md|txt)$/i)) {
        showMessage('upload', 'error', 'Please select a Markdown (.md) or text (.txt) file');
        return;
    }

    if (file.size > 1048576) {
        showMessage('upload', 'error', 'File size must be less than 1MB');
        return;
    }

    selectedFile = file;
    uploadBtn.disabled = false;
    dropZone.innerHTML = '<div class="upload-icon">✓</div><h3>' + file.name + '</h3><p>Ready to render</p>';

    if (!document.getElementById('uploadProjectName').value) {
        const name = file.name.replace(/\.(md|txt)$/i, '').replace(/_/g, ' ');
        document.getElementById('uploadProjectName').value = name;
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

    await render(text, null, false, false, false, 'editor');
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
    const exportPPT = format === 'ppt';
    const exportPDF = format === 'pdf';

    await render(text, null, exportExcel, exportPPT, exportPDF, prefix);
}

async function render(planText, projectName, exportExcel, exportPPT, exportPDF, prefix) {
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
        // Find the previous non-empty task line
        for (let i = this.lineNumber - 2; i >= 0; i--) {
            const line = lines[i].trim();
            if (line && !line.includes('===') && !line.includes('---') && !line.startsWith('#')) {
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
function calculateTaskDates(task, taskMap, lines) {
    // If task already has both dates, return it
    if (task.startDate && task.finishDate) {
        return task;
    }

    // Try to calculate from dependencies
    if (task.dependencies && !task.startDate) {
        const depNames = task.dependencies.split(',').map(d => d.trim());
        let latestFinishDate = null;

        for (const depName of depNames) {
            // Look up dependency in the map
            const depTask = taskMap.get(depName);
            if (depTask) {
                // Recursively calculate dependency dates if not set
                if (!depTask.finishDate) {
                    calculateTaskDates(depTask, taskMap, lines);
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
    const editor = document.getElementById('planEditor');
    const lines = editor.value.split('\n');
    const taskLine = lines[lineNumber - 1];

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
    document.getElementById('taskDependencies').value = task.dependencies || '';

    // Populate labels field if it exists
    const labelsInput = document.getElementById('taskLabels');
    if (labelsInput) {
        labelsInput.value = task.labels || '';
    }

    currentTaskLineNumber = lineNumber;
    updateRagDisplay();
    updateProgressBar();
    document.getElementById('taskFormOverlay').classList.add('active');
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
    document.getElementById('taskFormOverlay').classList.remove('active');
    currentTaskLineNumber = null;
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
    const dependencies = document.getElementById('taskDependencies').value.trim();

    // Get previous task name for dependency check
    const previousTaskName = getPreviousTaskName(lines, currentTaskLineNumber);

    // Parse dependencies - split by comma if multiple
    const depList = dependencies ? dependencies.split(',').map(d => d.trim()).filter(d => d) : [];

    // Filter out the previous task from explicit dependencies (will use * instead)
    const nonPreviousDeps = depList.filter(dep => dep !== previousTaskName);

    // Check if task depends on previous task
    const dependsOnPrevious = depList.includes(previousTaskName);

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

    let taskNamePart = dependsOnPrevious ? '*' + name : name;
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

    // Add percent
    if (percent) newLine += ' ' + percent + '%';

    // Add dates (ISO format) - only if user explicitly set them
    if (startDate && userSetStartDate) newLine += ' ' + startDate;
    if (finishDate && userSetFinishDate) newLine += ' ' + finishDate;

    // Add comment
    if (comment) newLine += ' "' + comment + '"';

    // Add dependencies (only non-previous ones, as * handles previous)
    if (nonPreviousDeps.length > 0) newLine += ' [depends ' + nonPreviousDeps.join(', ') + ']';

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

function getPreviousTaskName(lines, currentLineNum) {
    // Look backwards from current line to find the previous task
    for (let i = currentLineNum - 2; i >= 0; i--) {
        const line = lines[i].trim();
        // Skip empty lines, phase headers, and summary lines
        if (line && !line.includes('===') && !line.includes('---') && !line.startsWith('#')) {
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
    let text = trimmed;
    if (text.startsWith('*')) {
        hasStar = true;
        text = text.substring(1).trim();
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
        // Add previous task as dependency
        const editor = document.getElementById('planEditor');
        if (editor) {
            const lines = editor.value.split('\n');
            const previousTaskName = getPreviousTaskName(lines, lineNum);
            if (previousTaskName) {
                dependencies.unshift(previousTaskName);
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

document.addEventListener('DOMContentLoaded', function() {
    // Initialize resizer
    initResizer();
    // Close modal when clicking overlay
    const overlay = document.getElementById('taskFormOverlay');
    if (overlay) {
        overlay.addEventListener('click', function(e) {
            if (e.target === this) {
                closeTaskForm();
            }
        });
    }

    // Close modal when pressing Escape key
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

            // If no dropdown open, close the modal
            const overlay = document.getElementById('taskFormOverlay');
            if (overlay && overlay.classList.contains('active')) {
                closeTaskForm();
            }
        }
    });

    // Close autocomplete dropdowns when clicking outside
    document.addEventListener('click', function(e) {
        // Handle dependency autocomplete
        const depDropdown = document.getElementById('dependencyAutocomplete');
        const depInput = document.getElementById('taskDependencies');
        if (depDropdown && depInput && !depInput.contains(e.target) && !depDropdown.contains(e.target)) {
            depDropdown.style.display = 'none';
            autocompleteSelectedIndex = -1;
        }

        // Handle resource autocomplete
        const resDropdown = document.getElementById('resourceAutocomplete');
        const resInput = document.getElementById('taskResources');
        if (resDropdown && resInput && !resInput.contains(e.target) && !resDropdown.contains(e.target)) {
            resDropdown.style.display = 'none';
            resourceAutocompleteSelectedIndex = -1;
        }
    });

    // Add double-click handler to editor for opening task form
    const editor = document.getElementById('planEditor');
    if (editor) {
        // Double-click support
        editor.addEventListener('dblclick', function(e) {
            const textarea = e.target;
            const cursorPosition = textarea.selectionStart;
            const textBeforeCursor = textarea.value.substring(0, cursorPosition);
            const lineNumber = textBeforeCursor.split('\n').length;

            // Get the line content
            const lines = textarea.value.split('\n');
            const line = lines[lineNumber - 1];

            // Only open form for task lines (not empty lines, phase headers, or summary lines)
            if (line && line.trim() && !line.includes('===') && !line.includes('---')) {
                // Check if it looks like a task (has indentation or task markers)
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    openTaskForm(lineNumber);
                }
            }
        });

        // Double-tap support for mobile
        let lastTapTime = 0;
        let lastTapY = 0;
        editor.addEventListener('touchend', function(e) {
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
    const modal = document.getElementById('projectDetailsModal');
    modal.classList.add('active');

    // Parse and populate form from front matter
    populateProjectDetailsFromFrontMatter();

    // Focus on the first input
    setTimeout(() => {
        const firstInput = document.getElementById('projectOwner');
        if (firstInput) firstInput.focus();
    }, 100);
}

function closeProjectDetailsForm() {
    const modal = document.getElementById('projectDetailsModal');
    modal.classList.remove('active');
}

// Add ESC key handler for project details modal
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        const modal = document.getElementById('projectDetailsModal');
        if (modal && modal.classList.contains('active')) {
            closeProjectDetailsForm();
        }
    }
});

// Add click outside handler for project details modal
document.addEventListener('DOMContentLoaded', function() {
    const modal = document.getElementById('projectDetailsModal');
    if (modal) {
        modal.addEventListener('click', function(e) {
            // Close if clicking on the overlay (not on the modal content)
            if (e.target === modal) {
                closeProjectDetailsForm();
            }
        });
    }
});

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

function saveProjectDetails() {
    const editor = document.getElementById('planEditor');
    let content = editor.value;

    // Collect form data
    const title = document.getElementById('projectTitle').value.trim();
    const owner = document.getElementById('projectOwner').value.trim();
    const startDate = document.getElementById('projectStartDate').value.trim();
    const status = document.getElementById('projectStatus').value;
    const description = document.getElementById('projectDescription').value.trim();
    const budget = document.getElementById('projectBudget').value.trim();
    const labelsInput = document.getElementById('projectLabels').value.trim();

    // Collect resources
    const resources = [];
    const resourceInputs = document.querySelectorAll('#resourcesList input');
    resourceInputs.forEach(input => {
        if (input.value.trim()) {
            resources.push(input.value.trim());
        }
    });

    // Collect stakeholders
    const stakeholders = [];
    const stakeholderInputs = document.querySelectorAll('#stakeholdersList input');
    stakeholderInputs.forEach(input => {
        if (input.value.trim()) {
            stakeholders.push(input.value.trim());
        }
    });

    // Build front matter
    let frontMatter = '---\n';
    if (title) frontMatter += `title: ${title}\n`;
    if (owner) frontMatter += `project manager: ${owner}\n`;
    if (startDate) frontMatter += `start date: ${startDate}\n`;
    if (status && status !== 'Open') frontMatter += `status: ${status}\n`;
    if (description) frontMatter += `description: ${description}\n`;
    if (budget) frontMatter += `budget: ${budget}\n`;
    if (labelsInput) frontMatter += `labels: [${labelsInput}]\n`;

    if (resources.length > 0) {
        frontMatter += 'Resources:\n';
        resources.forEach(r => {
            frontMatter += `- ${r}\n`;
        });
    }

    if (stakeholders.length > 0) {
        frontMatter += 'Key Stakeholders:\n';
        stakeholders.forEach(s => {
            frontMatter += `- ${s}\n`;
        });
    }

    frontMatter += '---\n';

    // Remove existing front matter if present
    content = content.replace(/^---\s*\n[\s\S]*?\n---\n*/, '');

    // Add new front matter at the beginning
    editor.value = frontMatter + '\n' + content;

    // Trigger input event to update line numbers and render
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    // Close modal
    closeProjectDetailsForm();
}

/**
 * Kanban Editor Panel Functions
 */

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
