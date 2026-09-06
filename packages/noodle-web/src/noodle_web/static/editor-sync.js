/**
 * editor-sync.js — Sync functions between Gantt/table edits and the plan editor.
 * Depends on: state.js (globals)
 */

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

/**
 * Creates a mini piechart element that visually represents task completion percentage.
 * Replaces the traditional checkbox for tasks.
 * - Click: toggles between 100% and 0%
 * - Long press: shows a popup to set 0%, 25%, 50%, 75%, or 100%
 *
 * @param {number} percent - Current completion percentage (0-100)
 * @param {function} onPercentChange - Callback when percent changes, receives new percent string like '50%'
 * @returns {HTMLElement} The piechart div element
 */
function createMiniPiechart(percent, onPercentChange) {
    const piechart = document.createElement('div');
    piechart.className = 'mini-piechart';

    updatePiechartAppearance(piechart, percent);

    // Click handler: toggle between 100% and 0%
    let longPressTimer = null;
    let isLongPress = false;

    piechart.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        isLongPress = false;
        longPressTimer = setTimeout(() => {
            isLongPress = true;
            showPiechartPopup(piechart, percent, (newPercent) => {
                percent = newPercent;
                updatePiechartAppearance(piechart, percent);
                onPercentChange(percent + '%');
            });
        }, 500);
    });

    piechart.addEventListener('mouseup', (e) => {
        e.stopPropagation();
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        if (!isLongPress) {
            const newPercent = percent >= 100 ? 0 : 100;
            percent = newPercent;
            updatePiechartAppearance(piechart, percent);
            onPercentChange(percent + '%');
        }
    });

    piechart.addEventListener('mouseleave', () => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });

    // Touch support for long press
    piechart.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        isLongPress = false;
        longPressTimer = setTimeout(() => {
            isLongPress = true;
            showPiechartPopup(piechart, percent, (newPercent) => {
                percent = newPercent;
                updatePiechartAppearance(piechart, percent);
                onPercentChange(percent + '%');
            });
        }, 500);
    });

    piechart.addEventListener('touchend', (e) => {
        e.stopPropagation();
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        if (!isLongPress) {
            e.preventDefault();
            const newPercent = percent >= 100 ? 0 : 100;
            percent = newPercent;
            updatePiechartAppearance(piechart, percent);
            onPercentChange(percent + '%');
        }
    });

    piechart.addEventListener('touchcancel', () => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });

    return piechart;
}

function spawnConfetti(element) {
    const rect = element.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const colours = ['#28a745', '#ffc107', '#17a2b8', '#ff6b6b', '#6f42c1', '#fd7e14'];
    for (let i = 0; i < 16; i++) {
        const dot = document.createElement('div');
        dot.className = 'confetti-particle';
        const angle = (Math.PI * 2 * i) / 16 + (Math.random() - 0.5) * 0.4;
        const dist = 20 + Math.random() * 25;
        dot.style.setProperty('--tx', `${Math.cos(angle) * dist}px`);
        dot.style.setProperty('--ty', `${Math.sin(angle) * dist}px`);
        dot.style.left = cx + 'px';
        dot.style.top = cy + 'px';
        dot.style.background = colours[Math.floor(Math.random() * colours.length)];
        document.body.appendChild(dot);
        dot.addEventListener('animationend', () => dot.remove());
    }
}

function updatePiechartAppearance(element, percent) {
    if (percent >= 100) {
        element.classList.add('complete');
        element.style.removeProperty('--percent');
        element.style.background = '';
        element.title = 'Mark incomplete';
        spawnConfetti(element);
    } else {
        element.classList.remove('complete');
        element.style.setProperty('--percent', percent + '%');
        element.style.background = `conic-gradient(#28a745 0% ${percent}%, #e0e0e0 ${percent}% 100%)`;
        element.title = percent > 0 ? `${percent}% complete - click to complete` : 'Mark complete';
    }
}

function showPiechartPopup(piechartElement, currentPercent, onSelect) {
    // Remove any existing popup
    const existingPopup = document.querySelector('.piechart-popup');
    if (existingPopup) existingPopup.remove();

    const popup = document.createElement('div');
    popup.className = 'piechart-popup';

    const options = [0, 25, 50, 75, 100];
    options.forEach(value => {
        const btn = document.createElement('button');
        btn.className = 'piechart-popup-btn';
        btn.textContent = value + '%';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            onSelect(value);
            popup.remove();
        });
        popup.appendChild(btn);
    });

    // Position the popup near the piechart
    document.body.appendChild(popup);
    const rect = piechartElement.getBoundingClientRect();
    popup.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    popup.style.left = (rect.left + window.scrollX - 60) + 'px';

    // Close on click outside
    const closeHandler = (e) => {
        if (!popup.contains(e.target)) {
            popup.remove();
            document.removeEventListener('mousedown', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('mousedown', closeHandler), 10);
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
                const depTypes = task.dependency_types || {};
                const depParts = task.depends.map(depName => {
                    const depType = depTypes[depName];
                    const typeSuffix = (depType && depType !== 'FS') ? ':' + depType : '';
                    const lag = (task.lag_lead && task.lag_lead[depName]) ? ' ' + task.lag_lead[depName] : '';
                    return depName + typeSuffix + lag;
                });
                newDependsStr = '[depends ' + depParts.join(', ') + ']';
            }

            // Replace or add/remove the [depends ...] block in the line
            const dependsPattern = /\[depends(?::\s*|\s+)[^\]]+\]/i;
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
        // Find the end of the task name tokens.
        // A token is a "special" (non-name) token if it matches any known pattern:
        // duration, percent, resource, label, date, effort, priority, quoted, brackets, bucket
        function isSpecialToken(token) {
            return /^\d+[dwmy]$/.test(token) ||   // duration: 5d, 2w, 3m
                   /^\d+%$/.test(token) ||          // percent: 50%
                   /^@/.test(token) ||              // resource: @kev
                   /^#/.test(token) ||              // label: #DEV
                   /^\d{4}-\d{2}-\d{2}$/.test(token) || // date: 2025-01-15
                   /^~/.test(token) ||              // effort: ~8h/16h
                   /^!+$/.test(token) ||            // priority: !, !!, !!!
                   /^"/.test(token) ||              // quoted comment
                   /^\[/.test(token) ||             // bracket block [depends ...]
                   /^\{/.test(token);               // bucket {BucketName}
        }

        let insertIndex = tokens.length; // Default: end of tokens

        // Find the first special token - insert before it,
        // but skip past duration and effort tokens (percent goes after those)
        for (let i = 0; i < tokens.length; i++) {
            if (isSpecialToken(tokens[i])) {
                // Skip past duration and effort tokens - percent comes after them
                if (/^\d+[dwmy]$/.test(tokens[i]) || /^~/.test(tokens[i])) {
                    insertIndex = i + 1;
                    continue;
                }
                insertIndex = i;
                break;
            }
        }

        tokens.splice(insertIndex, 0, newPercent);
    }

    // Rebuild line with indent preserved
    return indent + tokens.join(' ');
}


