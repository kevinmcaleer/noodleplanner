/**
 * Kanban Board Implementation
 * Provides visual Kanban view of project plans
 * Phase 1 MVP: Read-only, phase-based grouping
 */

class KanbanBoard {
    constructor(viewMode = 'phase') {
        this.viewMode = viewMode; // 'phase', 'resource', 'progress', 'label', 'bucket'
        this.sortByPriority = false; // Sort tasks by priority within columns
        this.tasks = [];
        this.columns = [];
        this.phases = [];
        this.resourceMap = {}; // Maps shortname to full name from front matter
        this.labelsFromFrontMatter = []; // Labels defined in front matter
        this.currentParentTask = null; // Track current hierarchy level for drill-down
        this.hierarchyBreadcrumb = []; // Breadcrumb trail for navigation
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
        this.labelsFromFrontMatter = [];
        let currentPhase = null;
        let currentIndent = 0;
        let inFrontMatter = false;
        let frontMatterStart = -1;

        // First pass: Parse front matter to extract resource mappings and labels
        // Use shared parseResourceMappings function if available, otherwise inline
        if (typeof parseResourceMappings === 'function') {
            this.resourceMap = parseResourceMappings(planText);
        } else {
            // Fallback inline implementation for resources
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
        }

        // Parse labels in front matter (always do this, regardless of resource parsing method)
        inFrontMatter = false;
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

            // Parse labels in front matter: labels: [red, green, blue]
            if (inFrontMatter && line.trim().match(/^labels:\s*\[([^\]]+)\]/)) {
                const match = line.trim().match(/^labels:\s*\[([^\]]+)\]/);
                if (match) {
                    const labelsString = match[1];
                    this.labelsFromFrontMatter = labelsString.split(',').map(l => l.trim()).filter(l => l);
                }
            }
        }

        // Second pass: Parse tasks
        inFrontMatter = false;
        let inHighlights = false;
        let inRaidLog = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;
            const trimmedLine = line.trim();

            // Skip front matter entirely
            if (trimmedLine === '---') {
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

            // Track and skip highlights section
            if (trimmedLine === '---highlights---') {
                inHighlights = true;
                continue;
            }
            if (trimmedLine === '---end-highlights---') {
                inHighlights = false;
                continue;
            }

            // Track and skip RAID log section (extends to end of file)
            if (trimmedLine === '---raid log---') {
                inHighlights = false; // RAID log marker also ends highlights
                inRaidLog = true;
                continue;
            }

            if (inHighlights || inRaidLog) {
                continue;
            }

            // Skip empty lines
            if (!trimmedLine || line.startsWith('===')) {
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

                // Parse labels into array
                task.labelsArray = task.labels ?
                    task.labels.split(',').map(l => l.trim()).filter(l => l) :
                    [];

                // Determine progress status
                task.progressStatus = this.getProgressStatus(task.percent);

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
        // Handle undefined, null, empty string, or 0
        if (percent === undefined || percent === null || percent === '' || percent === '0' || percent === 0) {
            return 'not_started';
        }
        const p = parseInt(percent);
        if (isNaN(p) || p === 0) return 'not_started';
        if (p >= 100) return 'complete';
        return 'in_progress';
    }

    /**
     * Check if a task has subtasks (is a summary task)
     */
    hasSubtasks(task) {
        const taskIndent = task.indent;
        const taskLineNumber = task.lineNumber;

        // Look for direct child tasks (exactly one level deeper)
        const childIndent = taskIndent + 2; // 2-space indentation
        const childIndentAlt = taskIndent + 4; // 4-space indentation

        // Use all tasks (not filtered) to check for children
        const allTasks = this.getAllTasks();

        // Find tasks that come after this one
        const tasksAfter = allTasks.filter(t => t.lineNumber > taskLineNumber);

        for (const t of tasksAfter) {
            // If we hit a task at same or lower indent level, we've left this task's scope
            if (t.indent <= taskIndent) {
                return false;
            }

            // If we find a direct child (one level deeper), this is a summary task
            if (t.indent === childIndent || t.indent === childIndentAlt) {
                return true;
            }
        }

        return false;
    }

    /**
     * Drill down into a summary task
     * This shows the task and its siblings as columns, with their children as cards
     */
    drillDown(task) {
        // Only add to breadcrumb if we have a current parent (don't add "All Tasks" since it's always shown)
        if (this.currentParentTask) {
            this.hierarchyBreadcrumb.push({
                name: this.currentParentTask.name,
                task: this.currentParentTask
            });
        }
        // When drilling down, we want to show this task and its siblings as columns
        // So we set the currentParentTask to this task's parent (to get the right level)
        // But we also need to remember which task we clicked on
        this.currentViewTask = task; // The task we're viewing
        this.currentParentTask = task; // This will be used to find the right level
        this.groupTasksByViewMode();
        this.render();
        this.renderBreadcrumb();
    }

    /**
     * Navigate back in hierarchy
     */
    navigateUp(index = null) {
        if (index !== null) {
            // Navigate to specific breadcrumb level
            const target = this.hierarchyBreadcrumb[index];
            this.currentParentTask = target.task;
            this.hierarchyBreadcrumb = this.hierarchyBreadcrumb.slice(0, index);
        } else {
            // Navigate up one level
            if (this.hierarchyBreadcrumb.length > 0) {
                const parent = this.hierarchyBreadcrumb.pop();
                this.currentParentTask = parent.task;
            }
        }
        this.groupTasksByViewMode();
        this.render();
        this.renderBreadcrumb();
    }

    /**
     * Filter tasks to show only the current hierarchy level
     * When drilling down, show the task we clicked on and its siblings (same indent level)
     */
    filterTasksByHierarchyLevel() {
        const allTasks = this.allTasksCache || this.tasks;

        if (!this.currentParentTask) {
            // Root level: show only tasks with indent 0 or minimal indent (top-level tasks)
            return allTasks.filter(task => task.indent === 0 || task.indent <= 2);
        }

        // When drilling down, we want to show tasks at the same level as currentParentTask
        // (the task we clicked on and its siblings)
        const targetIndent = this.currentParentTask.indent;
        const targetLine = this.currentParentTask.lineNumber;


        // Find the parent of the current task (task with lower indent that comes before it)
        let parentOfCurrent = null;
        for (let i = targetLine - 2; i >= 0; i--) {
            const task = allTasks.find(t => t.lineNumber === i + 1);
            if (task && task.indent < targetIndent) {
                parentOfCurrent = task;
                break;
            }
        }

        if (!parentOfCurrent) {
        }

        // Filter to show only tasks at the same indent level as currentParentTask
        // that are children of the same parent
        const filtered = allTasks.filter(task => {
            // Must be at same indent level
            if (task.indent !== targetIndent) return false;

            // Must be after the parent (or at start if no parent)
            if (parentOfCurrent && task.lineNumber <= parentOfCurrent.lineNumber) return false;

            // Check if this task is within the same parent's scope
            if (parentOfCurrent) {
                // Find tasks between parent and this task
                const tasksBetween = allTasks.filter(t =>
                    t.lineNumber > parentOfCurrent.lineNumber &&
                    t.lineNumber < task.lineNumber
                );

                // If we hit a task at same or lower level than parent, this task is out of scope
                for (const t of tasksBetween) {
                    if (t.indent <= parentOfCurrent.indent) {
                        return false;
                    }
                }
            }

            return true;
        });

        return filtered;
    }

    /**
     * Get all tasks (used when we need the full list while this.tasks is filtered)
     */
    getAllTasks() {
        return this.allTasksCache || this.tasks;
    }

    /**
     * Group tasks based on current view mode
     */
    groupTasksByViewMode() {
        // Filter tasks by hierarchy level first
        const filteredTasks = this.filterTasksByHierarchyLevel();

        // Temporarily replace this.tasks with filtered tasks for grouping
        const allTasks = this.tasks;
        this.allTasksCache = allTasks; // Cache for getAllTasks()
        this.tasks = filteredTasks;

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
            case 'bucket':
                this.columns = this.groupTasksByBucket();
                break;
            default:
                this.columns = this.groupTasksByPhase();
        }

        // Apply priority sorting if enabled
        if (this.sortByPriority) {
            const priorityOrder = { 'Urgent': 0, 'Important': 1, 'Medium': 2, 'Low': 3 };
            this.columns.forEach(column => {
                column.tasks.sort((a, b) => {
                    const aPriority = priorityOrder[a.priority] ?? 3;
                    const bPriority = priorityOrder[b.priority] ?? 3;
                    return aPriority - bPriority;
                });
            });
        }

        // Restore all tasks
        this.tasks = allTasks;
    }

    /**
     * Group tasks by phase
     */
    groupTasksByPhase() {
        const columns = [];
        const phaseSet = new Set();

        // When drilling down, the filtered tasks are siblings at the same level
        // We want to show each summary task as a column with its children as cards
        if (this.currentParentTask) {
            // The filtered tasks are at the same level (siblings)
            // For each summary task at this level, create a column with its children

            const summaryTasks = this.tasks.filter(task => this.hasSubtasks(task));

            summaryTasks.forEach(summaryTask => {

                // Find all children of this summary task from the full task list
                const children = this.getAllTasks().filter(t => {
                    // Must be after the summary task
                    if (t.lineNumber <= summaryTask.lineNumber) return false;

                    // Must be more indented (child)
                    if (t.indent <= summaryTask.indent) return false;

                    // Check if it's a direct child (one level deeper)
                    const childIndent = summaryTask.indent + 2;
                    const childIndentAlt = summaryTask.indent + 4;
                    if (t.indent !== childIndent && t.indent !== childIndentAlt) return false;

                    // Check if there's a sibling or higher-level task between them
                    const tasksBetween = this.getAllTasks().filter(between =>
                        between.lineNumber > summaryTask.lineNumber &&
                        between.lineNumber < t.lineNumber
                    );

                    for (const between of tasksBetween) {
                        if (between.indent <= summaryTask.indent) {
                            return false; // Hit a sibling, this child is out of scope
                        }
                    }

                    return true;
                });


                columns.push({
                    id: this.sanitizeId(summaryTask.name),
                    title: summaryTask.name,
                    tasks: children,
                    count: children.length
                });
            });

        } else {
            // Root level: add all phases found during parsing (includes empty phases)
            this.phases.forEach(phase => {
                phaseSet.add(phase);
            });

            // Also add phases from tasks (in case a task has a phase not explicitly defined)
            this.tasks.forEach(task => {
                phaseSet.add(task.phase);
            });

            // Create a column for each phase
            phaseSet.forEach(phase => {
                const phaseTasks = this.tasks.filter(task => task.phase === phase);
                columns.push({
                    id: this.sanitizeId(phase),
                    title: phase,
                    tasks: phaseTasks,
                    count: phaseTasks.length
                });
            });
        }

        return columns;
    }

    /**
     * Group tasks by resource
     */
    groupTasksByResource() {
        const columns = [];
        const resourceMap = new Map(); // Maps normalized shortname to display name

        // When drilling down, only show resources from current filtered tasks
        // Otherwise, show all resources from front matter
        if (this.currentParentTask) {
            // Only collect resources from current filtered tasks
            this.tasks.forEach(task => {
                task.resourceShortnames.forEach((shortname, index) => {
                    if (!resourceMap.has(shortname)) {
                        const displayName = task.resourcesArray[index];
                        resourceMap.set(shortname, displayName);
                    }
                });
            });
        } else {
            // Root level: add all resources from front matter (so they appear even if no tasks assigned)
            Object.keys(this.resourceMap).forEach(shortname => {
                const displayName = this.resourceMap[shortname];
                resourceMap.set(shortname, displayName);
            });

            // Then collect all unique resources from tasks (in case tasks reference resources not in front matter)
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
        }

        // Add unassigned column
        resourceMap.set(null, 'Unassigned');

        // Create a column for each resource
        resourceMap.forEach((displayName, shortname) => {
            const resourceTasks = this.tasks.filter(task => {
                // Filter out summary tasks (parent tasks with children)
                if (this.hasSubtasks(task)) {
                    return false;
                }
                if (shortname === null) {
                    return task.resourcesArray.length === 0;
                }
                // Check if task has this resource (by normalized shortname)
                return task.resourceShortnames.includes(shortname);
            });

            // Skip empty columns when drilling down
            if (this.currentParentTask && resourceTasks.length === 0) {
                return;
            }

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

        return statusConfig.map(config => {
            const tasks = this.tasks.filter(task => task.progressStatus === config.status);
            return {
                id: config.id,
                title: config.title,
                tasks: tasks,
                count: tasks.length
            };
        }).filter(column => {
            // Skip empty columns when drilling down
            return !this.currentParentTask || column.tasks.length > 0;
        });
    }

    /**
     * Group tasks by label
     */
    groupTasksByLabel() {
        const columns = [];
        const labelSet = new Set();

        // When drilling down, only show labels from current filtered tasks
        // Otherwise, show all labels from front matter
        if (this.currentParentTask) {
            // Only collect labels from current filtered tasks
            this.tasks.forEach(task => {
                task.labelsArray.forEach(label => {
                    labelSet.add(label);
                });
            });
        } else {
            // Root level: add labels from front matter first (so they appear even if no tasks have them)
            this.labelsFromFrontMatter.forEach(label => {
                labelSet.add(label);
            });

            // Collect all unique labels from tasks
            this.tasks.forEach(task => {
                task.labelsArray.forEach(label => {
                    labelSet.add(label);
                });
            });
        }

        // Add unlabeled column
        labelSet.add('Unlabeled');

        // Create a column for each label
        labelSet.forEach(label => {
            const labelTasks = this.tasks.filter(task =>
                label === 'Unlabeled' ?
                    task.labelsArray.length === 0 :
                    task.labelsArray.includes(label)
            );

            // Skip empty columns when drilling down
            if (this.currentParentTask && labelTasks.length === 0) {
                return;
            }

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
     * Group tasks by bucket
     */
    groupTasksByBucket() {
        const columns = [];
        const bucketSet = new Set();

        // Collect all unique buckets from tasks
        this.tasks.forEach(task => {
            const bucket = task.bucket ? task.bucket.trim() : '';
            if (bucket) {
                bucketSet.add(bucket);
            }
        });

        // Add "No Bucket" column
        bucketSet.add('No Bucket');

        // Create a column for each bucket
        bucketSet.forEach(bucket => {
            const bucketTasks = this.tasks.filter(task => {
                // Filter out summary tasks (same as other views)
                if (this.hasSubtasks(task)) return false;
                if (bucket === 'No Bucket') {
                    return !task.bucket || !task.bucket.trim();
                }
                return task.bucket && task.bucket.trim() === bucket;
            });

            // Skip empty columns when drilling down
            if (this.currentParentTask && bucketTasks.length === 0) {
                return;
            }

            columns.push({
                id: this.sanitizeId(bucket),
                title: bucket,
                tasks: bucketTasks,
                count: bucketTasks.length
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
    /**
     * Render breadcrumb navigation
     */
    renderBreadcrumb() {
        const breadcrumbContainer = document.getElementById('kanbanBreadcrumb');
        if (!breadcrumbContainer) {
            console.warn('Breadcrumb container not found');
            return;
        }

        breadcrumbContainer.innerHTML = '';

        // Always show "All Tasks" as root
        const rootCrumb = document.createElement('span');
        rootCrumb.className = 'breadcrumb-item';
        if (this.hierarchyBreadcrumb.length === 0 && !this.currentParentTask) {
            rootCrumb.classList.add('active');
            rootCrumb.textContent = 'All Tasks';
        } else {
            rootCrumb.innerHTML = '<a href="#">All Tasks</a>';
            rootCrumb.querySelector('a').addEventListener('click', (e) => {
                e.preventDefault();
                this.currentParentTask = null;
                this.hierarchyBreadcrumb = [];
                this.groupTasksByViewMode();
                this.render();
                this.renderBreadcrumb();
            });
        }
        breadcrumbContainer.appendChild(rootCrumb);

        // Render breadcrumb trail
        this.hierarchyBreadcrumb.forEach((crumb, index) => {
            const separator = document.createElement('span');
            separator.className = 'breadcrumb-separator';
            separator.textContent = ' / ';
            breadcrumbContainer.appendChild(separator);

            const crumbEl = document.createElement('span');
            crumbEl.className = 'breadcrumb-item';
            crumbEl.innerHTML = `<a href="#">${crumb.name}</a>`;
            crumbEl.querySelector('a').addEventListener('click', (e) => {
                e.preventDefault();
                this.navigateUp(index);
            });
            breadcrumbContainer.appendChild(crumbEl);
        });

        // Add current level if viewing a specific parent
        if (this.currentParentTask) {
            const separator = document.createElement('span');
            separator.className = 'breadcrumb-separator';
            separator.textContent = ' / ';
            breadcrumbContainer.appendChild(separator);

            const currentCrumb = document.createElement('span');
            currentCrumb.className = 'breadcrumb-item active';
            currentCrumb.textContent = this.currentParentTask.name;
            breadcrumbContainer.appendChild(currentCrumb);
        }
    }

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

        // Show empty state if no tasks AND no columns (phases/labels/resources)
        // This allows empty phases to be shown even without tasks
        if (this.tasks.length === 0 && this.columns.length === 0) {
            this.renderEmptyState(boardContainer);
            return;
        }

        // Render each column (even if empty)
        this.columns.forEach(column => {
            const columnEl = this.renderColumn(column);
            boardContainer.appendChild(columnEl);
        });

        // Add "Add Column" button for phase, resource, and label views
        if (this.viewMode === 'phase' || this.viewMode === 'label' || this.viewMode === 'resource') {
            const addColumnEl = this.renderAddColumnButton();
            boardContainer.appendChild(addColumnEl);
        }
    }

    /**
     * Render empty state with helpful actions
     */
    renderEmptyState(container) {
        const emptyStateEl = document.createElement('div');
        emptyStateEl.className = 'kanban-empty-state';
        emptyStateEl.setAttribute('role', 'status');
        emptyStateEl.setAttribute('aria-live', 'polite');

        const titleEl = document.createElement('h3');
        titleEl.textContent = 'Start Your Project';
        emptyStateEl.appendChild(titleEl);

        const descEl = document.createElement('p');

        if (this.viewMode === 'phase') {
            descEl.textContent = 'Your plan is empty. Get started by adding phases and tasks.';
        } else if (this.viewMode === 'resource') {
            descEl.textContent = 'Your plan is empty. Get started by adding resources and tasks.';
        } else if (this.viewMode === 'progress') {
            descEl.textContent = 'Your plan is empty. Get started by adding tasks.';
        } else if (this.viewMode === 'label') {
            descEl.textContent = 'Your plan is empty. Get started by adding labels and tasks.';
        }

        emptyStateEl.appendChild(descEl);

        const actionsEl = document.createElement('div');
        actionsEl.className = 'kanban-empty-actions';

        // Add buttons based on view mode
        if (this.viewMode === 'phase') {
            const addPhaseBtn = document.createElement('button');
            addPhaseBtn.className = 'btn-primary';
            addPhaseBtn.textContent = '+ Add Phase';
            addPhaseBtn.setAttribute('aria-label', 'Add first phase');
            addPhaseBtn.addEventListener('click', () => this.addNewPhase());
            actionsEl.appendChild(addPhaseBtn);

            const addTaskBtn = document.createElement('button');
            addTaskBtn.className = 'btn-secondary';
            addTaskBtn.textContent = '+ Add Task';
            addTaskBtn.setAttribute('aria-label', 'Add first task');
            addTaskBtn.addEventListener('click', () => this.addFirstTask());
            actionsEl.appendChild(addTaskBtn);
        } else if (this.viewMode === 'resource') {
            const addResourceBtn = document.createElement('button');
            addResourceBtn.className = 'btn-primary';
            addResourceBtn.textContent = '+ Add Resource';
            addResourceBtn.setAttribute('aria-label', 'Add first resource');
            addResourceBtn.addEventListener('click', () => this.addNewResource());
            actionsEl.appendChild(addResourceBtn);

            const addTaskBtn = document.createElement('button');
            addTaskBtn.className = 'btn-secondary';
            addTaskBtn.textContent = '+ Add Task';
            addTaskBtn.setAttribute('aria-label', 'Add first task');
            addTaskBtn.addEventListener('click', () => this.addFirstTask());
            actionsEl.appendChild(addTaskBtn);
        } else if (this.viewMode === 'label') {
            const addLabelBtn = document.createElement('button');
            addLabelBtn.className = 'btn-primary';
            addLabelBtn.textContent = '+ Add Label';
            addLabelBtn.setAttribute('aria-label', 'Add first label');
            addLabelBtn.addEventListener('click', () => this.addNewLabel());
            actionsEl.appendChild(addLabelBtn);

            const addTaskBtn = document.createElement('button');
            addTaskBtn.className = 'btn-secondary';
            addTaskBtn.textContent = '+ Add Task';
            addTaskBtn.setAttribute('aria-label', 'Add first task');
            addTaskBtn.addEventListener('click', () => this.addFirstTask());
            actionsEl.appendChild(addTaskBtn);
        } else if (this.viewMode === 'progress') {
            // For progress view, show the 3 columns even when empty
            this.renderProgressColumnsEmpty(container);
            return;
        }

        emptyStateEl.appendChild(actionsEl);
        container.appendChild(emptyStateEl);
    }

    /**
     * Render empty progress columns (special case)
     */
    renderProgressColumnsEmpty(container) {
        const progressStates = [
            { id: 'not_started', name: 'Not Started', color: '#e74c3c' },
            { id: 'in_progress', name: 'In Progress', color: '#f39c12' },
            { id: 'complete', name: 'Complete', color: '#27ae60' }
        ];

        progressStates.forEach(state => {
            const columnEl = document.createElement('div');
            columnEl.className = 'kanban-column';
            columnEl.setAttribute('data-column-id', state.id);

            const headerEl = document.createElement('div');
            headerEl.className = 'kanban-column-header';

            const titleEl = document.createElement('h3');
            titleEl.className = 'kanban-column-title';
            titleEl.textContent = state.name;
            headerEl.appendChild(titleEl);

            const countEl = document.createElement('span');
            countEl.className = 'kanban-column-count';
            countEl.textContent = '0 tasks';
            headerEl.appendChild(countEl);

            columnEl.appendChild(headerEl);

            // Add empty message and Add Task button
            const cardsEl = document.createElement('div');
            cardsEl.className = 'kanban-cards';

            const emptyMsg = document.createElement('div');
            emptyMsg.className = 'kanban-column-empty';
            emptyMsg.textContent = 'No tasks yet';
            cardsEl.appendChild(emptyMsg);

            const addTaskBtn = document.createElement('button');
            addTaskBtn.className = 'kanban-add-task-btn';
            addTaskBtn.textContent = '+ Add Task';
            addTaskBtn.addEventListener('click', () => {
                // Determine percent based on column
                let percent = '';
                if (state.id === 'in_progress') percent = '50%';
                else if (state.id === 'complete') percent = '100%';
                this.addFirstTask(null, percent);
            });
            cardsEl.appendChild(addTaskBtn);

            columnEl.appendChild(cardsEl);
            container.appendChild(columnEl);
        });
    }

    /**
     * Render "Add Column" button for phase, resource, and label views
     */
    renderAddColumnButton() {
        const addColumnEl = document.createElement('div');
        addColumnEl.className = 'kanban-add-column';

        const button = document.createElement('button');
        button.className = 'kanban-add-column-btn';

        if (this.viewMode === 'phase') {
            // When drilling down, we're adding a summary task (which becomes a column)
            // At root level, we're adding a phase
            const buttonText = this.currentParentTask ? '+ Add Column' : '+ Add Phase';
            const ariaLabel = this.currentParentTask ? 'Add new summary task column' : 'Add new phase column';
            button.innerHTML = buttonText;
            button.setAttribute('aria-label', ariaLabel);
            button.addEventListener('click', () => {
                this.addNewPhase();
            });
        } else if (this.viewMode === 'resource') {
            button.innerHTML = '+ Add Resource';
            button.setAttribute('aria-label', 'Add new resource column');
            button.addEventListener('click', () => {
                this.addNewResource();
            });
        } else if (this.viewMode === 'label') {
            button.innerHTML = '+ Add Label';
            button.setAttribute('aria-label', 'Add new label column');
            button.addEventListener('click', () => {
                this.addNewLabel();
            });
        }

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

        const titleEl = document.createElement('h3');
        titleEl.className = 'kanban-column-title';
        titleEl.textContent = column.title;

        // Make title editable in phase view
        if (this.viewMode === 'phase') {
            titleEl.style.cursor = 'pointer';
            titleEl.title = 'Click to rename phase';
            titleEl.addEventListener('click', (e) => {
                e.stopPropagation();
                this.renamePhase(column.title);
            });
        }

        // Make title editable in label view (except Unlabeled)
        if (this.viewMode === 'label' && column.title !== 'Unlabeled') {
            titleEl.style.cursor = 'pointer';
            titleEl.title = 'Click to rename label';
            titleEl.addEventListener('click', (e) => {
                e.stopPropagation();
                this.renameLabel(column.title);
            });
        }

        headerEl.appendChild(titleEl);

        const countEl = document.createElement('span');
        countEl.className = 'kanban-column-count';
        countEl.textContent = `${column.count} ${column.count === 1 ? 'task' : 'tasks'}`;
        headerEl.appendChild(countEl);

        // Add delete button for label view (except Unlabeled)
        if (this.viewMode === 'label' && column.title !== 'Unlabeled') {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'kanban-column-delete';
            deleteBtn.innerHTML = '&times;';
            deleteBtn.title = `Remove label "${column.title}"`;
            deleteBtn.setAttribute('aria-label', `Remove label ${column.title}`);
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeLabel(column.title);
            });
            headerEl.appendChild(deleteBtn);
        }

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

        // Check if this is a summary task
        const isSummaryTask = this.hasSubtasks(task);

        // Make card clickable (but prevent click during drag)
        cardEl.style.cursor = 'grab';
        cardEl.addEventListener('click', (e) => {
            if (!cardEl.classList.contains('dragging')) {
                // If summary task and user clicks the drill-down button, handle it
                if (e.target.classList.contains('drill-down-btn')) {
                    e.stopPropagation();
                    this.drillDown(task);
                } else {
                    this.openTaskModal(task);
                }
            }
        });

        // Keyboard navigation - Enter/Space to open task
        cardEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (isSummaryTask && e.shiftKey) {
                    // Shift+Enter to drill down into summary task
                    this.drillDown(task);
                } else {
                    this.openTaskModal(task);
                }
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

        // Priority indicator dot
        if (task.priority && task.priority !== 'Low') {
            const dotEl = document.createElement('span');
            const level = task.priority.toLowerCase();
            dotEl.className = `kanban-priority-dot priority-dot-${level}`;
            dotEl.title = `Priority: ${task.priority}`;
            cardEl.appendChild(dotEl);
        }

        // Card footer with labels/dependencies/drill-down
        if (task.dependenciesArray.length > 0 || task.labelsArray.length > 0 || isSummaryTask) {
            const footerEl = document.createElement('div');
            footerEl.className = 'kanban-card-footer';

            const labelsEl = document.createElement('div');
            labelsEl.className = 'kanban-card-labels';

            // Show dependencies
            task.dependenciesArray.forEach(dep => {
                const labelEl = document.createElement('span');
                labelEl.className = 'label label-dependency';
                labelEl.textContent = `→ ${dep}`;
                labelEl.title = `Depends on: ${dep}`;
                labelsEl.appendChild(labelEl);
            });

            // Show labels
            task.labelsArray.forEach(label => {
                const labelEl = document.createElement('span');
                labelEl.className = 'label label-tag';
                labelEl.textContent = `#${label}`;
                labelsEl.appendChild(labelEl);
            });

            footerEl.appendChild(labelsEl);

            // Add drill-down button for summary tasks
            if (isSummaryTask) {
                const drillDownBtn = document.createElement('button');
                drillDownBtn.className = 'drill-down-btn';
                drillDownBtn.innerHTML = '&#x1F4C1; View Subtasks'; // Folder icon
                drillDownBtn.title = 'View subtasks of this task';
                drillDownBtn.setAttribute('aria-label', `View subtasks of ${task.name}`);
                footerEl.appendChild(drillDownBtn);
            }

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

            case 'label':
                // Update label assignment
                const labelName = targetColumn.title;
                if (labelName !== 'Unlabeled') {
                    // Add the new label (replace existing labels)
                    const updatedLine = this.replaceLabelsInTaskLine(taskLine, labelName);
                    lines[taskLineNumber - 1] = updatedLine;
                    updated = true;
                } else {
                    // Moving to Unlabeled - remove all labels
                    const updatedLine = this.removeLabelsFromTaskLine(taskLine);
                    lines[taskLineNumber - 1] = updatedLine;
                    updated = true;
                }
                break;
        }

        if (updated) {
            // Prevent circular updates
            if (window.kanbanIsUpdating) {
                window.kanbanIsUpdating(true);
            }

            // Update editor
            editor.value = lines.join('\n');

            // Dispatch input event to trigger editor listeners (e.g., line numbers)
            editor.dispatchEvent(new Event('input', { bubbles: true }));

            // Trigger immediate re-parse and render of Kanban and all views
            setTimeout(() => {
                this.parse();
                this.render();

                // Trigger main render to update all views (Report, Summary, Timeline, etc.)
                if (typeof renderText === 'function') {
                    renderText();
                }

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

        // Refresh Kanban and all views
        setTimeout(() => {
            this.parse();
            this.render();

            // Trigger main render to update all views (Report, Summary, Timeline, etc.)
            if (typeof renderText === 'function') {
                renderText();
            }

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

        // Refresh Kanban and all views
        setTimeout(() => {
            this.parse();
            this.render();

            // Trigger main render to update all views (Report, Summary, Timeline, etc.)
            if (typeof renderText === 'function') {
                renderText();
            }

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
                token.match(/^\d{4}-\d{2}-\d{2}$/) || token.startsWith('"') ||
                token.startsWith('#') || token.startsWith('[depends')) {
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

        // If line already has a [depends ...] block, add to it
        const dependsMatch = trimmed.match(/\[depends\s+([^\]]+)\]/i);
        if (dependsMatch) {
            return line.replace(/\[depends\s+([^\]]+)\]/i, `[depends $1, ${dependency}]`);
        } else {
            // Add [depends dependency] at the end (before comment if present)
            if (trimmed.includes('"')) {
                return line.replace(/"/, `[depends ${dependency}] "`);
            } else {
                return line + ` [depends ${dependency}]`;
            }
        }
    }

    /**
     * Replace all labels in task line with a single new label
     */
    replaceLabelsInTaskLine(line, newLabel) {
        const indent = line.match(/^(\s*)/)[1];
        const trimmed = line.trim();

        // Remove all existing #label tokens
        let updated = trimmed.replace(/#\w+/g, '').replace(/\s+/g, ' ').trim();

        // Add the new label at the end (before dependencies, dates, comment, or percent)
        const tokens = updated.split(/\s+/);
        let insertIndex = tokens.length;

        // Find position before dependencies, dates, percent, or comment
        for (let i = tokens.length - 1; i >= 0; i--) {
            const token = tokens[i];
            if (token.match(/^\d+%$/) || token.match(/^\d{4}-\d{2}-\d{2}$/) ||
                token.startsWith('"') || token.startsWith('[depends')) {
                insertIndex = i;
            } else {
                break;
            }
        }

        // Insert new label
        tokens.splice(insertIndex, 0, `#${newLabel}`);
        return indent + tokens.join(' ');
    }

    /**
     * Remove all labels from task line
     */
    removeLabelsFromTaskLine(line) {
        const indent = line.match(/^(\s*)/)[1];
        const trimmed = line.trim();

        // Remove all #label tokens and clean up extra spaces
        const updated = trimmed.replace(/#\w+/g, '').replace(/\s+/g, ' ').trim();
        return indent + updated;
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
            return false;
        }

        // Get the task line (with indentation)
        const taskLine = lines[taskLineNumber - 1];

        // Remove the task from its current position
        lines.splice(taskLineNumber - 1, 1);

        // Find where to insert in the target phase
        let insertIndex = lines.length;
        let needsIndentation = false;

        if (targetColumn.title === 'Unassigned') {
            // For unassigned, add at the end with no indentation
            insertIndex = lines.length;
            needsIndentation = false;
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
                    needsIndentation = true; // Tasks under a phase need indentation
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

        // Prepare the task line with proper indentation
        let lineToInsert = taskLine;
        if (needsIndentation) {
            // Remove existing indentation and add 2 spaces
            const trimmedTask = taskLine.trim();
            lineToInsert = '  ' + trimmedTask;
        } else {
            // For unassigned, remove indentation
            lineToInsert = taskLine.trim();
        }

        // Insert the task at the new location
        lines.splice(insertIndex, 0, lineToInsert);

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

        // Determine indentation based on hierarchy level
        let indentStr;
        if (this.currentParentTask) {
            // When drilling down, new tasks should be children of the current parent
            const parentIndent = this.currentParentTask.indent;
            indentStr = ' '.repeat(parentIndent + 2);
        } else {
            // Root level: standard indentation
            indentStr = '  ';
        }

        // Determine what to add based on view mode and column
        let newTaskLine = '';

        switch (this.viewMode) {
            case 'phase':
                // Add task under this phase
                newTaskLine = `${indentStr}New Task`;
                break;

            case 'resource':
                // Add task with this resource
                if (column.shortname && column.shortname !== null) {
                    newTaskLine = `${indentStr}New Task @${column.shortname}`;
                } else {
                    newTaskLine = `${indentStr}New Task`;
                }
                break;

            case 'progress':
                // Add task with appropriate progress
                const percent = this.getPercentFromProgressColumn(column.id);
                newTaskLine = `${indentStr}New Task ${percent}%`;
                break;

            case 'label':
                // Add task with this label
                if (column.id && column.id !== 'no_label') {
                    newTaskLine = `${indentStr}New Task #${column.id}`;
                } else {
                    newTaskLine = `${indentStr}New Task`;
                }
                break;
        }

        // Find appropriate place to insert
        const lines = editor.value.split('\n');
        let insertIndex = lines.length;

        if (this.currentParentTask) {
            // When drilling down, insert at end of parent task's children
            const parentIndent = this.currentParentTask.indent;
            const parentLineNumber = this.currentParentTask.lineNumber;

            insertIndex = parentLineNumber; // Start after parent

            for (let i = parentLineNumber; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();

                // Skip empty lines
                if (!trimmed) continue;

                const indent = line.search(/\S/);

                // If we hit a line at same or lower indentation than parent, we've found the end
                if (indent <= parentIndent) {
                    insertIndex = i;
                    break;
                }

                // Keep moving forward through children
                insertIndex = i + 1;
            }
        } else if (this.viewMode === 'phase' && column.title !== 'Unassigned') {
            // Root level phase view: find the last line of this phase
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
            this.renderBreadcrumb();

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
        const phaseName = prompt('Enter new column name:');
        if (!phaseName || phaseName.trim() === '') {
            return;
        }

        const editor = document.getElementById('planEditor');
        if (!editor) return;

        const lines = editor.value.split('\n');
        let insertIndex;
        let indentStr = '';
        let linesToAdd = [];

        // If we're drilling down, add a sibling to the current task at the same level
        if (this.currentParentTask) {
            // When drilling down, we're viewing siblings at the same level
            // So the new column should be at the SAME indent as currentParentTask (a sibling)
            const siblingIndent = this.currentParentTask.indent;
            const siblingLineNumber = this.currentParentTask.lineNumber;

            // New summary task should be at the same indent level (sibling)
            indentStr = ' '.repeat(siblingIndent);
            const childIndentStr = ' '.repeat(siblingIndent + 2);

            // Create summary task with a child task to make it appear as a column
            linesToAdd = [
                indentStr + phaseName.trim(),
                childIndentStr + 'New Task'
            ];

            // Find the end of all siblings at this level
            // We need to find the parent of the current task first
            let actualParentIndent = -1;
            for (let i = siblingLineNumber - 2; i >= 0; i--) {
                const line = lines[i];
                if (!line.trim()) continue;
                const indent = line.search(/\S/);
                if (indent < siblingIndent) {
                    actualParentIndent = indent;
                    break;
                }
            }

            // Now find the end of the siblings (where we hit a task at same or lower level than parent)
            insertIndex = siblingLineNumber;
            for (let i = siblingLineNumber; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();

                // Skip empty lines
                if (!trimmed) continue;

                const indent = line.search(/\S/);

                // If we hit a line at same or lower indentation than actual parent, we've found the end
                if (actualParentIndent >= 0 && indent <= actualParentIndent) {
                    insertIndex = i;
                    break;
                }

                // Keep moving forward
                insertIndex = i + 1;
            }
        } else {
            // Root level: add a phase header
            insertIndex = lines.length;

            // Add blank line if last line is not blank
            if (lines[lines.length - 1].trim() !== '') {
                lines.push('');
                insertIndex++;
            }

            linesToAdd = [phaseName.trim()];
        }

        // Insert the new lines at the calculated position
        lines.splice(insertIndex, 0, ...linesToAdd);

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
            this.groupTasksByViewMode();
            this.render();
            this.renderBreadcrumb();

            // Re-enable editor listener
            setTimeout(() => {
                if (window.kanbanIsUpdating) {
                    window.kanbanIsUpdating(false);
                }
            }, 100);
        }, 50);
    }

    /**
     * Add a new label to the front matter
     */
    addNewLabel() {
        const labelName = prompt('Enter new label name:');
        if (!labelName || labelName.trim() === '') {
            return;
        }

        // Normalize label to lowercase for consistency
        const normalizedLabel = labelName.trim().toLowerCase();

        const editor = document.getElementById('planEditor');
        if (!editor) return;

        const lines = editor.value.split('\n');
        let inFrontMatter = false;
        let frontMatterEnd = -1;
        let labelsLineIndex = -1;

        // Find front matter and labels line
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

            if (inFrontMatter && line.trim().match(/^labels:\s*\[/)) {
                labelsLineIndex = i;
            }
        }

        // If labels line exists, add to it
        if (labelsLineIndex >= 0) {
            const labelsLine = lines[labelsLineIndex];
            const match = labelsLine.match(/^(\s*labels:\s*\[)([^\]]*)(\].*)/);
            if (match) {
                const existingLabels = match[2].trim();
                const newLabels = existingLabels ?
                    existingLabels + ', ' + normalizedLabel :
                    normalizedLabel;
                lines[labelsLineIndex] = match[1] + newLabels + match[3];
            }
        } else if (frontMatterEnd >= 0) {
            // Front matter exists but no labels line - add it before the closing ---
            lines.splice(frontMatterEnd, 0, `labels: [${normalizedLabel}]`);
        } else {
            // No front matter - create it at the beginning
            lines.unshift('');  // Blank line after front matter
            lines.unshift('---');  // Closing ---
            lines.unshift(`labels: [${normalizedLabel}]`);  // Labels line
            lines.unshift('---');  // Opening ---
        }

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

            // Re-enable editor listener
            setTimeout(() => {
                if (window.kanbanIsUpdating) {
                    window.kanbanIsUpdating(false);
                }
            }, 100);
        }, 50);
    }

    /**
     * Add first task to an empty plan
     */
    addFirstTask(phaseName = null, percent = null) {
        const editor = document.getElementById('planEditor');
        if (!editor) return;

        const lines = editor.value.split('\n');
        let insertIndex = lines.length;

        // Find end of front matter if it exists
        let inFrontMatter = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim() === '---') {
                if (!inFrontMatter) {
                    inFrontMatter = true;
                } else {
                    // Found closing ---, insert after this
                    insertIndex = i + 1;
                    break;
                }
            }
        }

        // Add blank line if needed
        if (insertIndex < lines.length && lines[insertIndex].trim() !== '') {
            lines.splice(insertIndex, 0, '');
            insertIndex++;
        }

        // Add phase header if provided
        if (phaseName && phaseName.trim()) {
            lines.splice(insertIndex, 0, '', phaseName.trim());
            insertIndex += 2;
        }

        // Add task line with appropriate indent
        const indent = phaseName ? '  ' : '';
        let taskLine = `${indent}New Task`;

        if (percent) {
            taskLine += ` ${percent}`;
        }

        lines.splice(insertIndex, 0, taskLine);
        const newTaskLineNumber = insertIndex + 1; // Line numbers are 1-based

        // Prevent circular updates
        if (window.kanbanIsUpdating) {
            window.kanbanIsUpdating(true);
        }

        // Update editor
        editor.value = lines.join('\n');

        // Dispatch input event to trigger editor listeners
        editor.dispatchEvent(new Event('input', { bubbles: true }));

        // Refresh Kanban and open task form
        setTimeout(() => {
            this.parse();
            this.render();

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
     * Add a new resource to the front matter
     */
    addNewResource() {
        // Open the resource form
        if (typeof openResourceForm === 'function') {
            openResourceForm();
        }
    }

    /**
     * Rename a phase (summary task) in the plan
     */
    renamePhase(oldPhaseName) {
        const newPhaseName = prompt(`Rename phase "${oldPhaseName}" to:`, oldPhaseName);
        if (!newPhaseName || newPhaseName.trim() === '' || newPhaseName === oldPhaseName) {
            return;
        }

        const trimmedNewName = newPhaseName.trim();

        const editor = document.getElementById('planEditor');
        if (!editor) return;

        const lines = editor.value.split('\n');
        let inFrontMatter = false;
        let phaseHeaderFound = false;
        let firstTaskIndex = -1;

        // Find and rename the phase header
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Track front matter to skip it
            if (line.trim() === '---') {
                if (!inFrontMatter) {
                    inFrontMatter = true;
                } else {
                    inFrontMatter = false;
                }
                continue;
            }
            if (inFrontMatter) continue;

            // Check if this line is the phase header (no indentation, matches old name)
            const trimmedLine = line.trim();
            if (line.indexOf('  ') !== 0 && trimmedLine === oldPhaseName && !line.includes('[') && !line.includes('#')) {
                // This is a phase header line (no indentation, no resources, no labels)
                lines[i] = trimmedNewName;
                phaseHeaderFound = true;
            }

            // Track first task line (for Unassigned phase case)
            if (firstTaskIndex === -1 && !inFrontMatter && line.trim() && !line.trim().startsWith('#')) {
                // Check if it's a task line (has indentation or is first non-front-matter content)
                if (line.indexOf('  ') === 0 || line.trim().match(/^\*?[\w\s]+/)) {
                    firstTaskIndex = i;
                }
            }
        }

        // Special case: If renaming "Unassigned" phase and no phase header was found,
        // we need to CREATE a phase header before the first task
        if (oldPhaseName === 'Unassigned' && !phaseHeaderFound && firstTaskIndex !== -1) {
            // Insert phase header before first task
            lines.splice(firstTaskIndex, 0, trimmedNewName);

            // Indent all subsequent tasks that should be under this phase
            for (let i = firstTaskIndex + 1; i < lines.length; i++) {
                const line = lines[i];
                // Only indent non-empty lines that aren't already indented and aren't phase headers
                if (line.trim() && line.indexOf('  ') !== 0 && !line.includes('---')) {
                    lines[i] = '  ' + line;
                }
            }
        }

        // Prevent circular updates
        if (window.kanbanIsUpdating) {
            window.kanbanIsUpdating(true);
        }

        // Update editor
        editor.value = lines.join('\n');

        // Dispatch input event to trigger editor listeners
        editor.dispatchEvent(new Event('input', { bubbles: true }));

        // Refresh Kanban
        setTimeout(() => {
            this.parse();
            this.render();

            // Re-enable editor listener
            setTimeout(() => {
                if (window.kanbanIsUpdating) {
                    window.kanbanIsUpdating(false);
                }
            }, 100);
        }, 50);
    }

    /**
     * Rename a label in front matter and all tasks
     */
    renameLabel(oldLabelName) {
        const newLabelName = prompt(`Rename label "${oldLabelName}" to:`, oldLabelName);
        if (!newLabelName || newLabelName.trim() === '' || newLabelName === oldLabelName) {
            return;
        }

        // Normalize new label to lowercase for consistency
        const normalizedNewName = newLabelName.trim().toLowerCase();

        const editor = document.getElementById('planEditor');
        if (!editor) return;

        const lines = editor.value.split('\n');
        let inFrontMatter = false;
        let labelsLineIndex = -1;

        // Find front matter and labels line
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

            if (inFrontMatter && line.trim().match(/^labels:\s*\[/)) {
                labelsLineIndex = i;
            }
        }

        // Rename label in front matter
        if (labelsLineIndex >= 0) {
            const labelsLine = lines[labelsLineIndex];
            const match = labelsLine.match(/^(\s*labels:\s*\[)([^\]]*)(\].*)/);
            if (match) {
                const existingLabels = match[2].trim();
                const labelArray = existingLabels.split(',').map(l => l.trim()).filter(l => l);
                const updatedLabels = labelArray.map(l => l === oldLabelName ? normalizedNewName : l);
                lines[labelsLineIndex] = match[1] + updatedLabels.join(', ') + match[3];
            }
        }

        // Rename label in all tasks
        inFrontMatter = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Skip front matter
            if (line.trim() === '---') {
                if (!inFrontMatter) {
                    inFrontMatter = true;
                } else {
                    inFrontMatter = false;
                }
                continue;
            }
            if (inFrontMatter) continue;

            // Check if line has the old label
            const labelPattern = new RegExp(`#${oldLabelName}\\b`, 'g');
            if (labelPattern.test(line)) {
                // Replace the old label with the new label
                lines[i] = line.replace(labelPattern, `#${trimmedNewName}`);
            }
        }

        // Prevent circular updates
        if (window.kanbanIsUpdating) {
            window.kanbanIsUpdating(true);
        }

        // Update editor
        editor.value = lines.join('\n');

        // Dispatch input event to trigger editor listeners
        editor.dispatchEvent(new Event('input', { bubbles: true }));

        // Refresh Kanban
        setTimeout(() => {
            this.parse();
            this.render();

            // Re-enable editor listener
            setTimeout(() => {
                if (window.kanbanIsUpdating) {
                    window.kanbanIsUpdating(false);
                }
            }, 100);
        }, 50);
    }

    /**
     * Remove a label from front matter and all tasks
     */
    removeLabel(labelName) {
        if (!confirm(`Remove label "${labelName}" from all tasks and front matter?`)) {
            return;
        }

        const editor = document.getElementById('planEditor');
        if (!editor) return;

        const lines = editor.value.split('\n');
        let inFrontMatter = false;
        let labelsLineIndex = -1;

        // Find front matter and labels line
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

            if (inFrontMatter && line.trim().match(/^labels:\s*\[/)) {
                labelsLineIndex = i;
            }
        }

        // Remove label from front matter
        if (labelsLineIndex >= 0) {
            const labelsLine = lines[labelsLineIndex];
            const match = labelsLine.match(/^(\s*labels:\s*\[)([^\]]*)(\].*)/);
            if (match) {
                const existingLabels = match[2].trim();
                const labelArray = existingLabels.split(',').map(l => l.trim()).filter(l => l);
                const updatedLabels = labelArray.filter(l => l !== labelName);

                if (updatedLabels.length > 0) {
                    lines[labelsLineIndex] = match[1] + updatedLabels.join(', ') + match[3];
                } else {
                    // Remove the entire labels line if no labels left
                    lines.splice(labelsLineIndex, 1);
                }
            }
        }

        // Remove label from all tasks
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Skip front matter
            if (line.trim() === '---') {
                if (!inFrontMatter) {
                    inFrontMatter = true;
                } else {
                    inFrontMatter = false;
                }
                continue;
            }
            if (inFrontMatter) continue;

            // Check if line has the label
            const labelPattern = new RegExp(`#${labelName}\\b`, 'g');
            if (labelPattern.test(line)) {
                // Remove the label from this line
                lines[i] = line.replace(labelPattern, '').replace(/\s+/g, ' ').trim();

                // Restore indentation
                const indent = line.match(/^(\s*)/)[1];
                lines[i] = indent + lines[i];
            }
        }

        // Prevent circular updates
        if (window.kanbanIsUpdating) {
            window.kanbanIsUpdating(true);
        }

        // Update editor
        editor.value = lines.join('\n');

        // Dispatch input event to trigger editor listeners
        editor.dispatchEvent(new Event('input', { bubbles: true }));

        // Refresh Kanban
        setTimeout(() => {
            this.parse();
            this.render();

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
    kanbanBoard.renderBreadcrumb();
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
}

/**
 * Toggle priority sorting in kanban view
 */
function toggleKanbanPrioritySort(enabled) {
    if (!kanbanBoard) {
        initializeKanban();
        kanbanBoard.parse();
    }

    kanbanBoard.sortByPriority = enabled;
    kanbanBoard.parse();
    kanbanBoard.render();
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
