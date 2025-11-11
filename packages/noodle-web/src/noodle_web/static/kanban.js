/**
 * Kanban Board Implementation
 * Provides visual Kanban view of project plans
 * Phase 1 MVP: Read-only, phase-based grouping
 */

class KanbanBoard {
    constructor(viewMode = 'phase') {
        this.viewMode = viewMode; // 'phase', 'resource', 'progress', 'label'
        this.tasks = [];
        this.columns = [];
        this.phases = [];
        this.resourceMap = {}; // Maps shortname to full name from front matter
    }

    /**
     * Parse plan text into task objects and group into columns
     */
    parse() {
        const editor = document.getElementById('planEditor');
        if (!editor) {
            console.error('Plan editor not found');
            return;
        }

        const planText = editor.value;
        if (!planText || !planText.trim()) {
            this.tasks = [];
            this.columns = [];
            return;
        }

        const lines = planText.split('\n');
        this.tasks = [];
        this.phases = [];
        this.resourceMap = {};
        let currentPhase = null;
        let currentIndent = 0;
        let inFrontMatter = false;
        let frontMatterStart = -1;

        // First pass: Parse front matter to extract resource mappings
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Detect front matter boundaries
            if (line.trim() === '---') {
                if (!inFrontMatter) {
                    inFrontMatter = true;
                    frontMatterStart = i;
                } else {
                    // End of front matter
                    break;
                }
                continue;
            }

            // Parse resources in front matter
            if (inFrontMatter && line.trim().match(/^-\s*@(\w+):\s*(.+)/)) {
                const match = line.trim().match(/^-\s*@(\w+):\s*(.+)/);
                if (match) {
                    const shortname = match[1].toLowerCase(); // Normalize to lowercase
                    const fullInfo = match[2].trim();
                    // Extract just the name (before comma if present)
                    const fullName = fullInfo.split(',')[0].trim();
                    this.resourceMap[shortname] = fullName;
                }
            }
        }

        // Second pass: Parse tasks
        inFrontMatter = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;

            // Skip front matter entirely
            if (line.trim() === '---') {
                if (!inFrontMatter) {
                    inFrontMatter = true;
                    continue;
                } else {
                    inFrontMatter = false;
                    continue;
                }
            }

            if (inFrontMatter) {
                continue;
            }

            // Skip empty lines
            if (!line.trim() || line.startsWith('===')) {
                continue;
            }

            // Calculate indentation
            const indent = line.match(/^(\s*)/)[1].length;

            // Check if this is a phase header (no metadata, typically not indented or minimally indented)
            const trimmed = line.trim();
            const hasMetadata = /@|#|\d+[dmw]|\d+%|\d{4}-\d{2}-\d{2}/.test(trimmed);

            // If not indented (or minimally) and no metadata, it's likely a phase
            if (indent === 0 && !hasMetadata && trimmed.length > 0) {
                currentPhase = trimmed;
                currentIndent = indent;
                this.phases.push(currentPhase);
                continue;
            }

            // If slightly indented and we have a phase, it could still be a phase
            if (indent <= 4 && !hasMetadata && currentPhase && trimmed.length > 0) {
                // Check if this looks like a sub-phase
                if (indent > currentIndent) {
                    // It's a sub-task or sub-phase
                    // For now, treat as task under current phase
                } else {
                    // New phase at same or higher level
                    currentPhase = trimmed;
                    currentIndent = indent;
                    this.phases.push(currentPhase);
                    continue;
                }
            }

            // Parse as a task using existing parseTaskLine function
            const task = parseTaskLine(line, lineNum);

            // Only add if it has a name
            if (task.name && task.name.trim()) {
                // Add phase information
                task.phase = currentPhase || 'Unassigned';
                task.indent = indent;
                task.originalLine = line;

                // Parse resources into array and normalize to lowercase
                const rawResources = task.resources ?
                    task.resources.split(',').map(r => r.trim()).filter(r => r) :
                    [];

                // Convert shortnames to full names if available, otherwise use shortname
                task.resourcesArray = rawResources.map(shortname => {
                    const normalizedShortname = shortname.toLowerCase();
                    return this.resourceMap[normalizedShortname] || shortname;
                });

                // Also store the normalized shortnames for matching
                task.resourceShortnames = rawResources.map(r => r.toLowerCase());

                // Parse dependencies into array
                task.dependenciesArray = task.dependencies ?
                    task.dependencies.split(',').map(d => d.trim()).filter(d => d) :
                    [];

                // Determine progress status
                task.progressStatus = this.getProgressStatus(task.percent);

                // Extract labels from dependencies that look like labels
                task.labelsArray = task.dependenciesArray.filter(dep =>
                    dep.match(/^[A-Z][a-z]+$/) // Simple heuristic: capitalized words
                );

                this.tasks.push(task);
            }
        }

        // Group tasks by current view mode
        this.groupTasksByViewMode();
    }

    /**
     * Determine progress status from percentage
     */
    getProgressStatus(percent) {
        if (!percent || percent === '') return 'not_started';
        const p = parseInt(percent);
        if (p === 0) return 'not_started';
        if (p >= 100) return 'complete';
        return 'in_progress';
    }

    /**
     * Group tasks based on current view mode
     */
    groupTasksByViewMode() {
        switch (this.viewMode) {
            case 'phase':
                this.columns = this.groupTasksByPhase();
                break;
            case 'resource':
                this.columns = this.groupTasksByResource();
                break;
            case 'progress':
                this.columns = this.groupTasksByProgress();
                break;
            case 'label':
                this.columns = this.groupTasksByLabel();
                break;
            default:
                this.columns = this.groupTasksByPhase();
        }
    }

    /**
     * Group tasks by phase
     */
    groupTasksByPhase() {
        const columns = [];
        const phaseSet = new Set();

        // First, add all phases found during parsing (includes empty phases)
        this.phases.forEach(phase => {
            phaseSet.add(phase);
        });

        // Also add phases from tasks (in case a task has a phase not explicitly defined)
        this.tasks.forEach(task => {
            phaseSet.add(task.phase);
        });

        // Create a column for each phase (including empty ones)
        phaseSet.forEach(phase => {
            const phaseTasks = this.tasks.filter(task => task.phase === phase);
            columns.push({
                id: this.sanitizeId(phase),
                title: phase,
                tasks: phaseTasks,
                count: phaseTasks.length
            });
        });

        return columns;
    }

    /**
     * Group tasks by resource
     */
    groupTasksByResource() {
        const columns = [];
        const resourceMap = new Map(); // Maps normalized shortname to display name

        // Collect all unique resources (normalize by shortname to prevent duplicates)
        this.tasks.forEach(task => {
            task.resourceShortnames.forEach((shortname, index) => {
                // Use lowercase shortname as key to prevent "Kev" and "kev" duplicates
                if (!resourceMap.has(shortname)) {
                    // Store the display name for this shortname
                    const displayName = task.resourcesArray[index];
                    resourceMap.set(shortname, displayName);
                }
            });
        });

        // Add unassigned column
        resourceMap.set(null, 'Unassigned');

        // Create a column for each resource
        resourceMap.forEach((displayName, shortname) => {
            const resourceTasks = this.tasks.filter(task => {
                if (shortname === null) {
                    return task.resourcesArray.length === 0;
                }
                // Check if task has this resource (by normalized shortname)
                return task.resourceShortnames.includes(shortname);
            });

            columns.push({
                id: this.sanitizeId(displayName),
                title: displayName,
                shortname: shortname, // Store for later use in drag-and-drop
                tasks: resourceTasks,
                count: resourceTasks.length
            });
        });

        return columns;
    }

    /**
     * Group tasks by progress status
     */
    groupTasksByProgress() {
        const statusConfig = [
            { id: 'not_started', title: 'Not Started', status: 'not_started' },
            { id: 'in_progress', title: 'In Progress', status: 'in_progress' },
            { id: 'complete', title: 'Complete', status: 'complete' }
        ];

        return statusConfig.map(config => ({
            id: config.id,
            title: config.title,
            tasks: this.tasks.filter(task => task.progressStatus === config.status),
            count: this.tasks.filter(task => task.progressStatus === config.status).length
        }));
    }

    /**
     * Group tasks by label
     */
    groupTasksByLabel() {
        const columns = [];
        const labelSet = new Set();

        // Collect all unique labels
        this.tasks.forEach(task => {
            task.labelsArray.forEach(label => {
                labelSet.add(label);
            });
        });

        // Add unlabeled column
        labelSet.add('Unlabeled');

        // Create a column for each label
        labelSet.forEach(label => {
            const labelTasks = this.tasks.filter(task =>
                label === 'Unlabeled' ?
                    task.labelsArray.length === 0 :
                    task.labelsArray.includes(label)
            );
            columns.push({
                id: this.sanitizeId(label),
                title: label,
                tasks: labelTasks,
                count: labelTasks.length
            });
        });

        return columns;
    }

    /**
     * Sanitize string for use as HTML ID
     */
    sanitizeId(str) {
        return str.toLowerCase().replace(/[^a-z0-9]/g, '-');
    }

    /**
     * Render the Kanban board to DOM
     */
    render() {
        const boardContainer = document.getElementById('kanbanBoard');
        if (!boardContainer) {
            console.error('Kanban board container not found');
            return;
        }

        // Set ARIA attributes for the board
        boardContainer.setAttribute('role', 'main');
        boardContainer.setAttribute('aria-label', `Kanban board in ${this.viewMode} view`);

        // Clear existing content
        boardContainer.innerHTML = '';

        // Show empty state if no tasks
        if (this.tasks.length === 0) {
            boardContainer.innerHTML = `
                <div class="kanban-empty-state" role="status" aria-live="polite">
                    <h3>No tasks found</h3>
                    <p>Add some tasks to your plan in the Editor tab to see them here.</p>
                </div>
            `;
            return;
        }

        // Render each column
        this.columns.forEach(column => {
            const columnEl = this.renderColumn(column);
            boardContainer.appendChild(columnEl);
        });

        // Add "Add Column" button for phase view
        if (this.viewMode === 'phase') {
            const addColumnEl = this.renderAddColumnButton();
            boardContainer.appendChild(addColumnEl);
        }
    }

    /**
     * Render "Add Column" button for phase view
     */
    renderAddColumnButton() {
        const addColumnEl = document.createElement('div');
        addColumnEl.className = 'kanban-add-column';

        const button = document.createElement('button');
        button.className = 'kanban-add-column-btn';
        button.innerHTML = '+ Add Phase';
        button.setAttribute('aria-label', 'Add new phase column');
        button.addEventListener('click', () => {
            this.addNewPhase();
        });

        addColumnEl.appendChild(button);
        return addColumnEl;
    }

    /**
     * Render a single column
     */
    renderColumn(column) {
        const columnEl = document.createElement('div');
        columnEl.className = 'kanban-column';
        columnEl.setAttribute('data-column-id', column.id);
        columnEl.setAttribute('role', 'region');
        columnEl.setAttribute('aria-label', `${column.name} column with ${column.tasks.length} task${column.tasks.length !== 1 ? 's' : ''}`);

        // Column header
        const headerEl = document.createElement('div');
        headerEl.className = 'kanban-column-header';
        headerEl.innerHTML = `
            <h3 class="kanban-column-title">${this.escapeHtml(column.title)}</h3>
            <span class="kanban-column-count">${column.count} ${column.count === 1 ? 'task' : 'tasks'}</span>
        `;

        // Make column header draggable in phase view (except Unassigned)
        if (this.viewMode === 'phase' && column.title !== 'Unassigned') {
            columnEl.setAttribute('draggable', 'true');
            columnEl.classList.add('draggable-column');

            columnEl.addEventListener('dragstart', (e) => {
                columnEl.classList.add('dragging-column');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('application/x-column', column.title);
                // Prevent card drag events from interfering
                e.stopPropagation();
            });

            columnEl.addEventListener('dragend', (e) => {
                columnEl.classList.remove('dragging-column');
            });

            columnEl.addEventListener('dragover', (e) => {
                e.preventDefault();
                const draggingColumn = document.querySelector('.dragging-column');
                if (draggingColumn && draggingColumn !== columnEl) {
                    // Visual indicator
                    const rect = columnEl.getBoundingClientRect();
                    const midpoint = rect.left + rect.width / 2;

                    columnEl.classList.remove('drop-left', 'drop-right');
                    if (e.clientX < midpoint) {
                        columnEl.classList.add('drop-left');
                    } else {
                        columnEl.classList.add('drop-right');
                    }
                }
            });

            columnEl.addEventListener('dragleave', (e) => {
                columnEl.classList.remove('drop-left', 'drop-right');
            });

            columnEl.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                columnEl.classList.remove('drop-left', 'drop-right');

                const draggedColumnTitle = e.dataTransfer.getData('application/x-column');
                if (draggedColumnTitle && draggedColumnTitle !== column.title) {
                    // Determine insert position
                    const rect = columnEl.getBoundingClientRect();
                    const midpoint = rect.left + rect.width / 2;
                    const insertBefore = e.clientX < midpoint;

                    this.handleColumnReorder(draggedColumnTitle, column.title, insertBefore);
                }
            });
        }

        columnEl.appendChild(headerEl);

        // Column body
        const bodyEl = document.createElement('div');
        bodyEl.className = 'kanban-column-body';
        bodyEl.setAttribute('data-column-id', column.id);
        bodyEl.setAttribute('data-column-title', column.title);
        if (column.shortname) {
            bodyEl.setAttribute('data-column-shortname', column.shortname);
        }

        // Add drop zone event listeners
        bodyEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            bodyEl.classList.add('drag-over');
        });

        bodyEl.addEventListener('dragleave', (e) => {
            // Only remove if leaving the column body itself
            if (e.target === bodyEl) {
                bodyEl.classList.remove('drag-over');
            }
        });

        bodyEl.addEventListener('drop', (e) => {
            e.preventDefault();
            bodyEl.classList.remove('drag-over');

            const taskLineNumber = parseInt(e.dataTransfer.getData('text/plain'));
            this.handleCardDrop(taskLineNumber, column);
        });

        if (column.tasks.length === 0) {
            bodyEl.innerHTML = `
                <div class="kanban-column-empty">
                    No tasks in this ${this.viewMode}
                </div>
            `;
        } else {
            column.tasks.forEach(task => {
                const cardEl = this.renderCard(task);
                bodyEl.appendChild(cardEl);
            });
        }

        columnEl.appendChild(bodyEl);

        // Column footer with "Add Card" button
        const footerEl = document.createElement('div');
        footerEl.className = 'kanban-column-footer';

        const addButton = document.createElement('button');
        addButton.className = 'kanban-add-card-btn';
        addButton.innerHTML = '+ Add Task';
        addButton.setAttribute('aria-label', `Add new task to ${column.name}`);
        addButton.addEventListener('click', () => {
            this.addNewCard(column);
        });

        footerEl.appendChild(addButton);
        columnEl.appendChild(footerEl);

        return columnEl;
    }

    /**
     * Render a single task card
     */
    renderCard(task) {
        const cardEl = document.createElement('div');
        cardEl.className = 'kanban-card';
        cardEl.setAttribute('data-task-line', task.lineNumber);
        cardEl.setAttribute('data-task-name', task.name);
        cardEl.setAttribute('draggable', 'true');
        cardEl.setAttribute('role', 'button');
        cardEl.setAttribute('tabindex', '0');
        cardEl.setAttribute('aria-label', `Task: ${task.name}. Press Enter to edit, or drag to move.`);

        // Make card clickable (but prevent click during drag)
        cardEl.style.cursor = 'grab';
        cardEl.addEventListener('click', (e) => {
            if (!cardEl.classList.contains('dragging')) {
                this.openTaskModal(task);
            }
        });

        // Keyboard navigation - Enter/Space to open task
        cardEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.openTaskModal(task);
            }
        });

        // Drag and drop event listeners
        cardEl.addEventListener('dragstart', (e) => {
            cardEl.classList.add('dragging');
            cardEl.style.cursor = 'grabbing';
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', task.lineNumber.toString());
        });

        cardEl.addEventListener('dragend', (e) => {
            cardEl.classList.remove('dragging');
            cardEl.style.cursor = 'grab';
        });

        // Drag over card for reordering within column
        cardEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            const draggingCard = document.querySelector('.dragging');
            if (draggingCard && draggingCard !== cardEl) {
                // Get the bounding rectangle
                const rect = cardEl.getBoundingClientRect();
                const midpoint = rect.top + rect.height / 2;

                // Add visual indicator class
                cardEl.classList.remove('drop-before', 'drop-after');
                if (e.clientY < midpoint) {
                    cardEl.classList.add('drop-before');
                } else {
                    cardEl.classList.add('drop-after');
                }
            }
        });

        cardEl.addEventListener('dragleave', (e) => {
            cardEl.classList.remove('drop-before', 'drop-after');
        });

        // Drop on card for reordering
        cardEl.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            cardEl.classList.remove('drop-before', 'drop-after');

            const draggedLineNumber = parseInt(e.dataTransfer.getData('text/plain'));

            // Determine if inserting before or after this card
            const rect = cardEl.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const insertBefore = e.clientY < midpoint;

            this.handleCardReorder(draggedLineNumber, task.lineNumber, insertBefore);
        });

        // Card header with title and resources
        const headerEl = document.createElement('div');
        headerEl.className = 'kanban-card-header';

        const titleEl = document.createElement('h4');
        titleEl.className = 'kanban-card-title';
        titleEl.textContent = task.name;
        headerEl.appendChild(titleEl);

        // Resources avatars
        if (task.resourcesArray.length > 0) {
            const resourcesEl = document.createElement('div');
            resourcesEl.className = 'kanban-card-resources';

            // Show up to 10 resources
            const resourcesToShow = task.resourcesArray.slice(0, 10);
            resourcesToShow.forEach(resource => {
                const avatarEl = document.createElement('div');
                avatarEl.className = 'resource-avatar';
                avatarEl.title = resource;

                // Get initials (first letter of first and last name, or first 2 letters)
                const initials = this.getInitials(resource);
                avatarEl.textContent = initials;

                resourcesEl.appendChild(avatarEl);
            });

            headerEl.appendChild(resourcesEl);
        }

        cardEl.appendChild(headerEl);

        // Card body with metadata
        const bodyEl = document.createElement('div');
        bodyEl.className = 'kanban-card-body';

        // Meta row (duration, progress)
        const metaEl = document.createElement('div');
        metaEl.className = 'kanban-card-meta';

        if (task.duration) {
            const durationEl = document.createElement('span');
            durationEl.className = 'kanban-meta-duration';
            durationEl.textContent = `${task.duration}d`;
            metaEl.appendChild(durationEl);
        }

        if (task.percent) {
            const progressEl = document.createElement('span');
            progressEl.className = 'kanban-meta-progress';
            progressEl.textContent = `${task.percent}%`;

            // Add color based on progress
            if (task.progressStatus === 'complete') {
                progressEl.classList.add('progress-complete');
            } else if (task.progressStatus === 'in_progress') {
                progressEl.classList.add('progress-in-progress');
            } else {
                progressEl.classList.add('progress-not-started');
            }

            metaEl.appendChild(progressEl);
        }

        bodyEl.appendChild(metaEl);

        // Comment
        if (task.comment) {
            const commentEl = document.createElement('p');
            commentEl.className = 'kanban-card-comment';
            commentEl.textContent = task.comment;
            bodyEl.appendChild(commentEl);
        }

        cardEl.appendChild(bodyEl);

        // Card footer with labels/dependencies
        if (task.dependenciesArray.length > 0 || task.labelsArray.length > 0) {
            const footerEl = document.createElement('div');
            footerEl.className = 'kanban-card-footer';

            const labelsEl = document.createElement('div');
            labelsEl.className = 'kanban-card-labels';

            // Show dependencies as labels
            task.dependenciesArray.forEach(dep => {
                const labelEl = document.createElement('span');
                labelEl.className = 'label label-dependency';
                labelEl.textContent = `#${dep}`;
                labelsEl.appendChild(labelEl);
            });

            footerEl.appendChild(labelsEl);
            cardEl.appendChild(footerEl);
        }

        return cardEl;
    }

    /**
     * Get initials from a name
     */
    getInitials(name) {
        const words = name.trim().split(/\s+/);
        if (words.length >= 2) {
            return (words[0][0] + words[words.length - 1][0]).toUpperCase();
        } else if (words.length === 1 && words[0].length >= 2) {
            return words[0].substring(0, 2).toUpperCase();
        } else {
            return name.substring(0, 1).toUpperCase();
        }
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Open task modal for editing
     * Reuses existing task form modal from script.js
     */
    openTaskModal(task) {
        // Check if the openTaskForm function exists (from script.js)
        if (typeof openTaskForm === 'function') {
            // Call the existing modal function with line number
            openTaskForm(task.lineNumber);
        } else {
            console.error('openTaskForm function not found. Make sure script.js is loaded.');
        }
    }

    /**
     * Handle card drop event - update task and sync back to editor
     */
    handleCardDrop(taskLineNumber, targetColumn) {
        // Find the task
        const task = this.tasks.find(t => t.lineNumber === taskLineNumber);
        if (!task) {
            console.error('Task not found:', taskLineNumber);
            return;
        }

        // Update task based on view mode
        let updated = false;
        const editor = document.getElementById('planEditor');
        if (!editor) return;

        const lines = editor.value.split('\n');
        const taskLine = lines[taskLineNumber - 1];

        switch (this.viewMode) {
            case 'phase':
                // Move task to a different phase by relocating the line
                updated = this.moveTaskToPhase(lines, taskLineNumber, targetColumn);
                break;

            case 'resource':
                // Replace resource assignment
                const shortname = targetColumn.shortname;
                if (shortname !== null) {
                    // Moving to a resource column - replace with new resource
                    const updatedLine = this.replaceResourceInTaskLine(taskLine, shortname);
                    lines[taskLineNumber - 1] = updatedLine;
                    updated = true;
                } else {
                    // Moving to Unassigned - remove all resources
                    const updatedLine = this.removeResourcesFromTaskLine(taskLine);
                    lines[taskLineNumber - 1] = updatedLine;
                    updated = true;
                }
                break;

            case 'progress':
                // Update percentage based on column
                const newPercent = this.getPercentFromProgressColumn(targetColumn.id);
                const updatedLine = this.updatePercentInTaskLine(taskLine, newPercent);
                lines[taskLineNumber - 1] = updatedLine;
                updated = true;
                break;
        }

        if (updated) {
            // Prevent circular updates
            if (window.kanbanIsUpdating) {
                window.kanbanIsUpdating(true);
            }

            // Update editor
            editor.value = lines.join('\n');

            // Dispatch input event to trigger editor listeners (e.g., line numbers, render)
            editor.dispatchEvent(new Event('input', { bubbles: true }));

            // Trigger immediate re-parse and render
            setTimeout(() => {
                this.parse();
                this.render();
                showKanbanMessage('Task updated successfully', 'success');

                // Re-enable editor listener after update
                setTimeout(() => {
                    if (window.kanbanIsUpdating) {
                        window.kanbanIsUpdating(false);
                    }
                }, 100);
            }, 50);
        }
    }

    /**
     * Handle column (phase) reordering
     */
    handleColumnReorder(draggedPhaseTitle, targetPhaseTitle, insertBefore) {
        const editor = document.getElementById('planEditor');
        if (!editor) return;

        const lines = editor.value.split('\n');

        // Find the dragged phase and all its tasks
        let draggedPhaseStart = -1;
        let draggedPhaseEnd = -1;
        let targetPhaseStart = -1;

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed === draggedPhaseTitle && draggedPhaseStart === -1) {
                draggedPhaseStart = i;
            } else if (trimmed === targetPhaseTitle) {
                targetPhaseStart = i;
            }
        }

        if (draggedPhaseStart === -1 || targetPhaseStart === -1) {
            return;
        }

        // Find end of dragged phase (next phase header or end of file)
        draggedPhaseEnd = draggedPhaseStart + 1;
        while (draggedPhaseEnd < lines.length) {
            const trimmed = lines[draggedPhaseEnd].trim();
            const indent = lines[draggedPhaseEnd].match(/^(\s*)/)[1].length;
            const hasMetadata = /@|#|\d+[dmw]|\d+%|\d{4}-\d{2}-\d{2}/.test(trimmed);

            // Stop at next phase (non-indented, no metadata, not empty)
            if (indent === 0 && !hasMetadata && trimmed.length > 0) {
                break;
            }
            draggedPhaseEnd++;
        }

        // Extract the phase block
        const phaseBlock = lines.slice(draggedPhaseStart, draggedPhaseEnd);

        // Remove the phase block
        lines.splice(draggedPhaseStart, draggedPhaseEnd - draggedPhaseStart);

        // Adjust target position if needed
        let adjustedTargetPos = targetPhaseStart;
        if (draggedPhaseStart < targetPhaseStart) {
            adjustedTargetPos -= (draggedPhaseEnd - draggedPhaseStart);
        }

        // Find end of target phase
        let targetPhaseEnd = adjustedTargetPos + 1;
        while (targetPhaseEnd < lines.length) {
            const trimmed = lines[targetPhaseEnd].trim();
            const indent = lines[targetPhaseEnd].match(/^(\s*)/)[1].length;
            const hasMetadata = /@|#|\d+[dmw]|\d+%|\d{4}-\d{2}-\d{2}/.test(trimmed);

            if (indent === 0 && !hasMetadata && trimmed.length > 0) {
                break;
            }
            targetPhaseEnd++;
        }

        // Insert phase block
        if (insertBefore) {
            lines.splice(adjustedTargetPos, 0, ...phaseBlock);
        } else {
            lines.splice(targetPhaseEnd, 0, ...phaseBlock);
        }

        // Prevent circular updates
        if (window.kanbanIsUpdating) {
            window.kanbanIsUpdating(true);
        }

        // Update editor
        editor.value = lines.join('\n');

        // Dispatch input event
        editor.dispatchEvent(new Event('input', { bubbles: true }));

        // Refresh Kanban
        setTimeout(() => {
            this.parse();
            this.render();
            showKanbanMessage(`Phase "${draggedPhaseTitle}" moved`, 'success');

            // Re-enable editor listener
            setTimeout(() => {
                if (window.kanbanIsUpdating) {
                    window.kanbanIsUpdating(false);
                }
            }, 100);
        }, 50);
    }

    /**
     * Handle card reordering within the same column
     */
    handleCardReorder(draggedLineNumber, targetLineNumber, insertBefore) {
        if (draggedLineNumber === targetLineNumber) {
            return; // Can't reorder with itself
        }

        const editor = document.getElementById('planEditor');
        if (!editor) return;

        const lines = editor.value.split('\n');

        // Get the dragged line
        const draggedLine = lines[draggedLineNumber - 1];

        // Remove the dragged line
        lines.splice(draggedLineNumber - 1, 1);

        // Adjust target line number if needed (if dragged line was before target)
        let adjustedTargetLine = targetLineNumber;
        if (draggedLineNumber < targetLineNumber) {
            adjustedTargetLine--;
        }

        // Insert at new position
        if (insertBefore) {
            lines.splice(adjustedTargetLine - 1, 0, draggedLine);
        } else {
            lines.splice(adjustedTargetLine, 0, draggedLine);
        }

        // Prevent circular updates
        if (window.kanbanIsUpdating) {
            window.kanbanIsUpdating(true);
        }

        // Update editor
        editor.value = lines.join('\n');

        // Dispatch input event
        editor.dispatchEvent(new Event('input', { bubbles: true }));

        // Refresh Kanban
        setTimeout(() => {
            this.parse();
            this.render();
            showKanbanMessage('Task reordered', 'success');

            // Re-enable editor listener
            setTimeout(() => {
                if (window.kanbanIsUpdating) {
                    window.kanbanIsUpdating(false);
                }
            }, 100);
        }, 50);
    }

    /**
     * Replace all resources in task line with a single new resource
     */
    replaceResourceInTaskLine(line, newShortname) {
        const indent = line.match(/^(\s*)/)[1];
        const trimmed = line.trim();

        // Remove all existing @resource tokens
        let updated = trimmed.replace(/@\w+/g, '').replace(/\s+/g, ' ').trim();

        // Add the new resource after task name
        const tokens = updated.split(/\s+/);
        let insertIndex = 0;

        // Find position after task name and any * prefix
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (token.startsWith('*')) {
                insertIndex = i + 1;
                continue;
            }
            if (token.match(/^\d+[dmw]$/) || token.match(/^\d+%$/) ||
                token.match(/^\d{4}-\d{2}-\d{2}$/) || token.startsWith('"') || token.startsWith('#')) {
                break;
            }
            insertIndex = i + 1;
        }

        // Insert new resource
        tokens.splice(insertIndex, 0, `@${newShortname}`);
        return indent + tokens.join(' ');
    }

    /**
     * Remove all resources from task line
     */
    removeResourcesFromTaskLine(line) {
        const indent = line.match(/^(\s*)/)[1];
        const trimmed = line.trim();

        // Remove all @resource tokens and clean up extra spaces
        const updated = trimmed.replace(/@\w+/g, '').replace(/\s+/g, ' ').trim();
        return indent + updated;
    }

    /**
     * Add resource to task line
     */
    addResourceToTaskLine(line, shortname) {
        // Find where to insert the resource (after task name, before or with other resources)
        const trimmed = line.trim();
        const indent = line.match(/^(\s*)/)[1];

        // If line already has resources, add to them
        if (trimmed.includes('@')) {
            // Add after existing resources
            return line.replace(/(@\w+(?:\s+@\w+)*)/, `$1 @${shortname}`);
        } else {
            // Add after task name (first word or words before any metadata)
            const tokens = trimmed.split(/\s+/);
            const nameTokens = [];
            let insertIndex = 0;

            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];
                if (token.startsWith('*')) {
                    insertIndex = i + 1;
                    continue;
                }
                if (token.startsWith('@') || token.startsWith('#') || token.match(/^\d+[dmw]$/) ||
                    token.match(/^\d+%$/) || token.match(/^\d{4}-\d{2}-\d{2}$/) || token.startsWith('"')) {
                    break;
                }
                nameTokens.push(token);
                insertIndex = i + 1;
            }

            // Insert resource after name
            tokens.splice(insertIndex, 0, `@${shortname}`);
            return indent + tokens.join(' ');
        }
    }

    /**
     * Update percent in task line
     */
    updatePercentInTaskLine(line, newPercent) {
        const indent = line.match(/^(\s*)/)[1];
        const trimmed = line.trim();

        // Remove existing percent if present
        let updated = trimmed.replace(/\s+\d+%/, '');

        // Add new percent at the end (before comment if present)
        if (updated.includes('"')) {
            updated = updated.replace(/"/, `${newPercent}% "`);
        } else {
            updated = updated + ` ${newPercent}%`;
        }

        return indent + updated;
    }

    /**
     * Add dependency to task line
     */
    addDependencyToTaskLine(line, dependency) {
        const indent = line.match(/^(\s*)/)[1];
        const trimmed = line.trim();

        // If line already has dependencies, add to them
        if (trimmed.includes('#')) {
            return line.replace(/(#\w+(?:\s+#\w+)*)/, `$1 #${dependency}`);
        } else {
            // Add after resources or task name
            const tokens = trimmed.split(/\s+/);
            let insertIndex = 0;

            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];
                if (token.startsWith('@')) {
                    insertIndex = i + 1;
                    continue;
                }
                if (token.match(/^\d+[dmw]$/) || token.match(/^\d+%$/) ||
                    token.match(/^\d{4}-\d{2}-\d{2}$/) || token.startsWith('"')) {
                    break;
                }
                if (!token.startsWith('*') && !token.startsWith('#')) {
                    insertIndex = i + 1;
                }
            }

            tokens.splice(insertIndex, 0, `#${dependency}`);
            return indent + tokens.join(' ');
        }
    }

    /**
     * Move task to a different phase
     */
    moveTaskToPhase(lines, taskLineNumber, targetColumn) {
        // Don't move if already in the correct phase
        const task = this.tasks.find(t => t.lineNumber === taskLineNumber);
        if (!task) return false;

        // Check if task is already in this phase
        if (task.phase === targetColumn.title) {
            showKanbanMessage('Task is already in this phase', 'info');
            return false;
        }

        // Get the task line (with indentation)
        const taskLine = lines[taskLineNumber - 1];

        // Remove the task from its current position
        lines.splice(taskLineNumber - 1, 1);

        // Find where to insert in the target phase
        let insertIndex = lines.length;

        if (targetColumn.title === 'Unassigned') {
            // For unassigned, add at the end
            insertIndex = lines.length;
        } else {
            // Find the phase header and last line of that phase
            let foundPhase = false;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();

                // Check if this is the target phase header
                if (trimmed === targetColumn.title) {
                    foundPhase = true;
                    insertIndex = i + 1;
                    continue;
                }

                // If we found the phase, keep updating insert index until we hit another phase
                if (foundPhase) {
                    const indent = line.match(/^(\s*)/)[1].length;
                    const hasMetadata = /@|#|\d+[dmw]|\d+%|\d{4}-\d{2}-\d{2}/.test(trimmed);

                    // If we hit another non-indented line, it's a new phase or section
                    if (indent === 0 && trimmed.length > 0 && !hasMetadata) {
                        break;
                    }

                    // If line is part of this phase, update insert index
                    if (trimmed.length > 0) {
                        insertIndex = i + 1;
                    }
                }
            }
        }

        // Insert the task at the new location
        lines.splice(insertIndex, 0, taskLine);

        return true;
    }

    /**
     * Get percentage value from progress column ID
     */
    getPercentFromProgressColumn(columnId) {
        switch (columnId) {
            case 'not_started':
                return 0;
            case 'in_progress':
                return 50;
            case 'complete':
                return 100;
            default:
                return 0;
        }
    }

    /**
     * Add new card to column
     */
    addNewCard(column) {
        const editor = document.getElementById('planEditor');
        if (!editor) return;

        // Determine what to add based on view mode and column
        let newTaskLine = '';
        const indent = '  '; // Standard indentation for tasks

        switch (this.viewMode) {
            case 'phase':
                // Add task under this phase
                newTaskLine = `${indent}New Task`;
                break;

            case 'resource':
                // Add task with this resource
                if (column.shortname && column.shortname !== null) {
                    newTaskLine = `${indent}New Task @${column.shortname}`;
                } else {
                    newTaskLine = `${indent}New Task`;
                }
                break;

            case 'progress':
                // Add task with appropriate progress
                const percent = this.getPercentFromProgressColumn(column.id);
                newTaskLine = `${indent}New Task ${percent}%`;
                break;
        }

        // Find appropriate place to insert (end of phase for phase view, or end of file)
        const lines = editor.value.split('\n');
        let insertIndex = lines.length;

        if (this.viewMode === 'phase' && column.title !== 'Unassigned') {
            // Find the last line of this phase
            let foundPhase = false;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();

                // Check if this is the phase header
                if (trimmed === column.title) {
                    foundPhase = true;
                    insertIndex = i + 1;
                    continue;
                }

                // If we found the phase, keep updating insert index until we hit another phase or end
                if (foundPhase) {
                    const indent = line.match(/^(\s*)/)[1].length;
                    const hasMetadata = /@|#|\d+[dmw]|\d+%|\d{4}-\d{2}-\d{2}/.test(trimmed);

                    // If we hit another non-indented line without metadata, it's a new phase
                    if (indent === 0 && !hasMetadata && trimmed.length > 0 && trimmed !== column.title) {
                        break;
                    }

                    // If line is part of this phase, update insert index
                    if (trimmed.length > 0) {
                        insertIndex = i + 1;
                    }
                }
            }
        }

        // Insert the new task
        lines.splice(insertIndex, 0, newTaskLine);

        // Prevent circular updates
        if (window.kanbanIsUpdating) {
            window.kanbanIsUpdating(true);
        }

        // Update editor
        editor.value = lines.join('\n');

        // Dispatch input event to trigger editor listeners (e.g., line numbers, render)
        editor.dispatchEvent(new Event('input', { bubbles: true }));

        // Calculate the line number of the new task (insertIndex is 0-based, line numbers are 1-based)
        const newTaskLineNumber = insertIndex + 1;

        // Refresh Kanban
        setTimeout(() => {
            this.parse();
            this.render();
            showKanbanMessage('New task added', 'success');

            // Open the task form for the new task
            setTimeout(() => {
                if (typeof openTaskForm === 'function') {
                    openTaskForm(newTaskLineNumber);
                }
            }, 200);

            // Re-enable editor listener
            setTimeout(() => {
                if (window.kanbanIsUpdating) {
                    window.kanbanIsUpdating(false);
                }
            }, 100);
        }, 50);
    }

    /**
     * Add a new phase to the plan
     */
    addNewPhase() {
        const phaseName = prompt('Enter new phase name:');
        if (!phaseName || phaseName.trim() === '') {
            return;
        }

        const editor = document.getElementById('planEditor');
        if (!editor) return;

        const lines = editor.value.split('\n');

        // Add the new phase at the end of the file
        // Add blank line if last line is not blank
        if (lines[lines.length - 1].trim() !== '') {
            lines.push('');
        }

        // Add phase header
        lines.push(phaseName.trim());

        // Prevent circular updates
        if (window.kanbanIsUpdating) {
            window.kanbanIsUpdating(true);
        }

        // Update editor
        editor.value = lines.join('\n');

        // Dispatch input event to trigger editor listeners (e.g., line numbers, render)
        editor.dispatchEvent(new Event('input', { bubbles: true }));

        // Refresh Kanban
        setTimeout(() => {
            this.parse();
            this.render();
            showKanbanMessage(`Phase "${phaseName.trim()}" added`, 'success');

            // Re-enable editor listener
            setTimeout(() => {
                if (window.kanbanIsUpdating) {
                    window.kanbanIsUpdating(false);
                }
            }, 100);
        }, 50);
    }

    /**
     * Switch view mode and re-render
     */
    switchViewMode(newMode) {
        this.viewMode = newMode;
        this.groupTasksByViewMode();
        this.render();
    }
}

// Global Kanban board instance
let kanbanBoard = null;

/**
 * Initialize Kanban view
 */
function initializeKanban() {
    kanbanBoard = new KanbanBoard('phase');
}

/**
 * Sync Kanban from editor (manual sync button)
 */
function syncKanbanFromEditor() {
    if (!kanbanBoard) {
        initializeKanban();
    }

    kanbanBoard.parse();
    kanbanBoard.render();

    // Show success message
    showKanbanMessage('Kanban view synced from editor', 'success');
}

/**
 * Switch Kanban view mode
 */
function switchKanbanView(mode) {
    if (!kanbanBoard) {
        initializeKanban();
        kanbanBoard.parse();
    }

    kanbanBoard.switchViewMode(mode);

    // Show message
    const modeNames = {
        'phase': 'Phase',
        'resource': 'Resource',
        'progress': 'Progress'
    };
    showKanbanMessage(`Switched to ${modeNames[mode]} view`, 'info');
}

/**
 * Show temporary message in Kanban view
 */
function showKanbanMessage(message, type = 'info') {
    // Remove existing message if present
    const existingMessage = document.querySelector('.kanban-message');
    if (existingMessage) {
        existingMessage.remove();
    }

    // Create message element
    const messageEl = document.createElement('div');
    messageEl.className = `kanban-message kanban-message-${type}`;
    messageEl.textContent = message;

    // Add to kanban header
    const header = document.querySelector('.kanban-header');
    if (header) {
        header.appendChild(messageEl);

        // Auto-remove after 3 seconds
        setTimeout(() => {
            messageEl.classList.add('fade-out');
            setTimeout(() => messageEl.remove(), 300);
        }, 3000);
    }
}

// Initialize Kanban when script loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initializeKanban();
        setupKanbanAutoSync();
    });
} else {
    initializeKanban();
    setupKanbanAutoSync();
}

/**
 * Setup auto-sync between editor and Kanban
 */
function setupKanbanAutoSync() {
    // Listen for tab switches
    const kanbanTab = document.querySelector('.tab[onclick*="kanban"]');
    if (kanbanTab) {
        kanbanTab.addEventListener('click', () => {
            // Auto-load Kanban when switching to Kanban tab
            setTimeout(() => {
                if (document.getElementById('kanban-tab').classList.contains('active')) {
                    syncKanbanFromEditor();
                }
            }, 100);
        });
    }

    // Listen for editor changes (debounced to avoid too frequent updates)
    const editor = document.getElementById('planEditor');
    if (editor) {
        let editorChangeTimeout = null;
        let isKanbanUpdating = false; // Prevent circular updates

        editor.addEventListener('input', () => {
            // Only auto-sync if Kanban tab is active and we're not in the middle of a Kanban update
            if (!document.getElementById('kanban-tab').classList.contains('active') || isKanbanUpdating) {
                return;
            }

            // Debounce: wait 1 second after last change
            clearTimeout(editorChangeTimeout);
            editorChangeTimeout = setTimeout(() => {
                if (kanbanBoard && document.getElementById('kanban-tab').classList.contains('active')) {
                    kanbanBoard.parse();
                    kanbanBoard.render();
                }
            }, 1000);
        });

        // Store reference to prevent circular updates
        window.kanbanIsUpdating = function(value) {
            isKanbanUpdating = value;
        };
    }

    // Listen for task form saves to refresh Kanban
    const saveButton = document.querySelector('[onclick*="saveTask"]');
    if (saveButton) {
        saveButton.addEventListener('click', () => {
            setTimeout(() => {
                if (document.getElementById('kanban-tab').classList.contains('active') && kanbanBoard) {
                    kanbanBoard.parse();
                    kanbanBoard.render();
                }
            }, 500);
        });
    }
}
