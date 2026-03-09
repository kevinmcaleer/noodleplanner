/**
 * nav.js — Navigation, view switching, splitters, templates, and tour.
 * Depends on: state.js (globals)
 */

/**
 * Update the project breadcrumb indicator in the nav bar.
 * @param {string|null} projectName - The project name to display, or null/empty to hide.
 */
function updateProjectBreadcrumb(projectName) {
    const el = document.getElementById('projectBreadcrumb');
    const nameEl = document.getElementById('projectBreadcrumbName');
    if (!el || !nameEl) return;
    if (projectName) {
        nameEl.textContent = projectName;
        el.style.display = '';
    } else {
        el.style.display = 'none';
    }
}

function toggleExportMenu(event) {
    event.stopPropagation();
    const menu = document.getElementById('exportMenu');
    if (menu) menu.classList.toggle('show');
}

// Close nav dropdown menus when clicking outside
document.addEventListener('click', function(e) {
    // Close all nav dropdown menus when clicking outside
    const navMenus = [
        { menu: 'toolsMenu', tab: 'toolsTab' }
    ];
    navMenus.forEach(({ menu: menuId, tab: tabId }) => {
        const navMenu = document.getElementById(menuId);
        const navTab = document.getElementById(tabId);
        if (navMenu && !navMenu.contains(e.target) && (!navTab || !navTab.contains(e.target))) {
            navMenu.classList.remove('show');
        }
    });
});

// Close all nav dropdown menus (optionally except one)
function closeAllNavMenus(except) {
    const menuIds = ['toolsMenu'];
    menuIds.forEach(id => {
        if (id !== except) {
            const m = document.getElementById(id);
            if (m) m.classList.remove('show');
        }
    });
}

// Navigate to Project (Dashboard with plan subnav)
function switchToProject() {
    switchToView('project-report');
    // Override nav active state to show Project tab as active (not Dashboard)
    document.querySelectorAll('.tabs .tab').forEach(tab => tab.classList.remove('active'));
    const planTab = document.getElementById('planTab');
    if (planTab) planTab.classList.add('active');
}

// Navigate to Tracking (RAID Log with tracking subnav)
function switchToTracking() {
    switchTrackingSubnavToTab('actions');
    // Ensure Tracking tab is active
    document.querySelectorAll('.tabs .tab').forEach(tab => tab.classList.remove('active'));
    const trackingTab = document.getElementById('trackingTab');
    if (trackingTab) trackingTab.classList.add('active');
}

// Navigate to Resources (Resource Table with resources subnav)
function switchToResources() {
    switchToView('resources');
    // Ensure Resources tab is active
    document.querySelectorAll('.tabs .tab').forEach(tab => tab.classList.remove('active'));
    const resourcesTab = document.getElementById('resourcesTab');
    if (resourcesTab) resourcesTab.classList.add('active');
}

// Toggle Tools dropdown menu
function toggleToolsMenu(event) {
    event.stopPropagation();
    closeAllNavMenus('toolsMenu');
    document.getElementById('toolsMenu').classList.toggle('show');
}

// Templates Modal Functions
// Templates state is in state.js

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
    // Sync editor state from kanban to main if switching away from kanban
    const kanbanTab = document.getElementById('kanban-tab');
    if (kanbanTab && kanbanTab.classList.contains('active')) {
        syncEditorStateToMain();
    }

    // First, switch to editor tab (where all views live)
    switchTab('editor');

    // Then switch to the specific output tab content
    switchOutputTab(viewName);

    // Close all nav dropdown menus
    closeAllNavMenus();

    // Update nav bar active state
    updateNavActiveState(viewName);

    // Update plan sub-navigation bar
    updatePlanSubnav(viewName);
}

// Update the active state in the navigation bar
function updateNavActiveState(viewName) {
    // Remove active class from all nav tabs
    document.querySelectorAll('.tabs .tab').forEach(tab => {
        tab.classList.remove('active');
    });

    // Map view names to their parent nav dropdown tab
    const viewToNavTab = {
        'project-report': 'dashboardTab',
        'tasks': 'planTab',
        'gantt': 'planTab',
        'kanban': 'planTab',
        'calendar': 'planTab',
        'timeline': 'planTab',
        'milestones': 'planTab',
        'mindmap': 'planTab',
        'stakeholders': 'planTab',
        'raid': 'trackingTab',
        'actions': 'trackingTab',
        'highlights': 'trackingTab',
        'lookahead': 'trackingTab',
        'analysis': 'trackingTab',
        'budget': 'trackingTab',
        'evm': 'trackingTab',
        'resources': 'resourcesTab',
        'timesheet': 'resourcesTab',
        'user-workload': 'resourcesTab',
        'resource-sheet': 'resourcesTab',
        'text-report': 'toolsTab',
        'planning': 'toolsTab',
        'guide': 'toolsTab'
    };

    const navTabId = viewToNavTab[viewName];
    if (navTabId) {
        const navTab = document.getElementById(navTabId);
        if (navTab) navTab.classList.add('active');
    }
}

// Navigation constants (PLAN_VIEWS, TRACKING_VIEWS, etc.) are in state.js

// Show or hide all sub-navs and highlight the active button
function updatePlanSubnav(viewName) {
    SUBNAV_GROUPS.forEach(({ id, views }) => {
        const subnav = document.getElementById(id);
        if (!subnav) return;

        const isActive = views.includes(viewName);
        subnav.classList.toggle('visible', isActive);

        if (isActive) {
            subnav.querySelectorAll('.plan-subnav-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.view === viewName);
            });
        }
    });
}

// Handle Dashboard button in the plan sub-nav
function switchPlanSubnavToDashboard() {
    switchToView('project-report');
    // Override nav active state to keep Project tab active (not Dashboard tab)
    document.querySelectorAll('.tabs .tab').forEach(tab => tab.classList.remove('active'));
    const planTab = document.getElementById('planTab');
    if (planTab) planTab.classList.add('active');
}

// Handle Board button in the plan sub-nav
function switchPlanSubnavToBoard() {
    syncEditorStateToKanban();
    switchTab('kanban');
    updatePlanSubnav('kanban');
}

// Handle Tracking subnav buttons that use switchTab (RAID, Actions)
function switchTrackingSubnavToTab(tabName) {
    switchTab(tabName);
    updatePlanSubnav(tabName);
}

// Handle Tools subnav buttons that use switchTab (Planning Room, Syntax Guide)
function switchToolsSubnavToTab(tabName) {
    switchTab(tabName);
    updatePlanSubnav(tabName);
}

// Sync editor panel collapsed/expanded state from main editor to kanban editor
function syncEditorStateToKanban() {
    const mainPanel = document.querySelector('.editor-panel');
    const kanbanPanel = document.getElementById('kanbanEditorPanel');
    const kanbanSplitter = document.getElementById('kanbanSplitter');
    const kanbanArrow = document.getElementById('kanbanSplitterArrow');

    if (!mainPanel || !kanbanPanel || !kanbanSplitter || !kanbanArrow) return;

    const mainIsCollapsed = mainPanel.classList.contains('collapsed');

    if (mainIsCollapsed) {
        kanbanPanel.classList.add('collapsed');
        kanbanSplitter.classList.add('collapsed');
        kanbanArrow.textContent = '\u25B6';
    } else {
        kanbanPanel.classList.remove('collapsed');
        kanbanSplitter.classList.remove('collapsed');
        kanbanArrow.textContent = '\u25C0';
    }
}

// Sync editor panel collapsed/expanded state from kanban editor to main editor
function syncEditorStateToMain() {
    const mainPanel = document.querySelector('.editor-panel');
    const mainSplitter = document.getElementById('editorSplitter');
    const mainArrow = document.getElementById('editorSplitterArrow');
    const kanbanPanel = document.getElementById('kanbanEditorPanel');

    if (!mainPanel || !mainSplitter || !mainArrow || !kanbanPanel) return;

    const kanbanIsCollapsed = kanbanPanel.classList.contains('collapsed');

    if (kanbanIsCollapsed) {
        mainPanel.classList.add('collapsed');
        mainSplitter.classList.add('collapsed');
        mainArrow.textContent = '\u25B6';
    } else {
        mainPanel.classList.remove('collapsed');
        mainSplitter.classList.remove('collapsed');
        mainArrow.textContent = '\u25C0';
        // Restore saved width
        const savedWidth = localStorage.getItem('editorPanelWidth');
        if (savedWidth) {
            mainPanel.style.width = savedWidth + 'px';
        }
    }
}

// Switch between output tab content panels (Tasks, Project Report, Milestones, etc.)
function switchOutputTab(tabName) {
    // Hide all tab content
    document.querySelectorAll('.output-tab-content').forEach(content => {
        content.classList.remove('active');
    });

    // Show selected tab content
    const tabView = document.getElementById(`${tabName}-view`);
    if (tabView) {
        tabView.classList.add('active');
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

    // If switching to tasks or gantt view, re-render embedded timeline if visible
    if ((tabName === 'tasks' || tabName === 'gantt') && timelineTasks.length > 0) {
        setTimeout(() => {
            updateEmbeddedTimeline(tabName + '-view');
        }, 50);
    }

    // If switching to calendar view, re-render after layout is ready
    if (tabName === 'calendar' && calendarTasks.length > 0) {
        setTimeout(() => {
            renderCalendarMonth(calendarCurrentYear, calendarCurrentMonth);
        }, 50);
    }

    // If switching to mind map view, re-render after layout is ready
    if (tabName === 'mindmap' && typeof updateMindmap === 'function') {
        setTimeout(() => {
            if (mindmapTree) {
                initMindmap();
                mindmapLayout(mindmapTree);
                mindmapRender();
                mindmapZoomFit();
            } else {
                // Ensure placeholder is shown for empty state
                const placeholder = document.querySelector('#mindmap-view .mindmap-placeholder');
                const content = document.querySelector('#mindmap-view .mindmap-content');
                if (placeholder) placeholder.style.display = '';
                if (content) content.style.display = 'none';
            }
        }, 50);
    }

    // If switching to stakeholders view, load from front matter if needed and render
    if (tabName === 'stakeholders') {
        if (stakeholderItems.length === 0) {
            loadStakeholdersFromPlanText();
        }
        setTimeout(() => {
            renderStakeholderTable();
            renderStakeholderGrid();
        }, 50);
    }
}

// Resizer state is in state.js

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

// Gantt splitter and editor splitter state is in state.js

/**
 * Initialize the draggable editor splitter for resizing the editor panel.
 */
function initEditorSplitter() {
    const splitter = document.getElementById('editorSplitter');
    const panel = document.querySelector('.editor-panel');
    const layout = document.querySelector('.editor-layout');

    if (!splitter || !panel || !layout) return;

    // Restore saved width from localStorage
    const savedWidth = localStorage.getItem('editorPanelWidth');
    if (savedWidth) {
        panel.style.width = savedWidth + 'px';
    }

    // Mouse events for drag
    splitter.addEventListener('mousedown', handleEditorSplitterStart);
    document.addEventListener('mousemove', handleEditorSplitterMove);
    document.addEventListener('mouseup', handleEditorSplitterEnd);

    // Touch events for mobile drag
    splitter.addEventListener('touchstart', handleEditorSplitterTouchStart, { passive: false });
    document.addEventListener('touchmove', handleEditorSplitterTouchMove, { passive: false });
    document.addEventListener('touchend', handleEditorSplitterTouchEnd);

    // Handle window resize to keep panel within bounds
    window.addEventListener('resize', constrainEditorPanelWidth);
}

function handleEditorSplitterStart(e) {
    const panel = document.querySelector('.editor-panel');
    const splitter = document.getElementById('editorSplitter');
    // Do not start drag if editor is collapsed or if clicking the arrow button
    if (!panel || panel.classList.contains('collapsed') || e.target.closest('.splitter-arrow')) return;

    isEditorResizing = true;
    editorStartX = e.clientX;
    editorStartWidth = panel.offsetWidth;
    panel.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
}

function handleEditorSplitterMove(e) {
    if (!isEditorResizing) return;

    const panel = document.querySelector('.editor-panel');
    const layout = document.querySelector('.editor-layout');
    if (!panel || !layout) return;

    const delta = e.clientX - editorStartX;
    const newWidth = editorStartWidth + delta;
    const maxWidth = layout.offsetWidth * 0.7;

    if (newWidth >= EDITOR_MIN_WIDTH && newWidth <= maxWidth) {
        panel.style.width = newWidth + 'px';
    }
}

function handleEditorSplitterEnd() {
    if (!isEditorResizing) return;

    isEditorResizing = false;
    const panel = document.querySelector('.editor-panel');
    if (panel) {
        panel.classList.remove('dragging');
        localStorage.setItem('editorPanelWidth', panel.offsetWidth);
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    // Re-render timeline and gantt after width change
    refreshVisualsAfterResize();
}

function handleEditorSplitterTouchStart(e) {
    const panel = document.querySelector('.editor-panel');
    if (!panel || panel.classList.contains('collapsed') || e.target.closest('.splitter-arrow')) return;

    isEditorResizing = true;
    editorStartX = e.touches[0].clientX;
    editorStartWidth = panel.offsetWidth;
    panel.classList.add('dragging');
    e.preventDefault();
}

function handleEditorSplitterTouchMove(e) {
    if (!isEditorResizing) return;

    const panel = document.querySelector('.editor-panel');
    const layout = document.querySelector('.editor-layout');
    if (!panel || !layout) return;

    const delta = e.touches[0].clientX - editorStartX;
    const newWidth = editorStartWidth + delta;
    const maxWidth = layout.offsetWidth * 0.7;

    if (newWidth >= EDITOR_MIN_WIDTH && newWidth <= maxWidth) {
        panel.style.width = newWidth + 'px';
    }
}

function handleEditorSplitterTouchEnd() {
    if (!isEditorResizing) return;

    isEditorResizing = false;
    const panel = document.querySelector('.editor-panel');
    if (panel) {
        panel.classList.remove('dragging');
        localStorage.setItem('editorPanelWidth', panel.offsetWidth);
    }

    refreshVisualsAfterResize();
}

/**
 * Constrain editor panel width when the window is resized.
 */
function constrainEditorPanelWidth() {
    const panel = document.querySelector('.editor-panel');
    const layout = document.querySelector('.editor-layout');
    if (!panel || !layout || panel.classList.contains('collapsed')) return;

    const maxWidth = layout.offsetWidth * 0.7;
    if (panel.offsetWidth > maxWidth) {
        panel.style.width = maxWidth + 'px';
    }
}

/**
 * Re-render timeline and gantt charts after a resize operation.
 */
function refreshVisualsAfterResize() {
    setTimeout(() => {
        if (typeof timelineTasks !== 'undefined' && timelineTasks.length > 0) {
            updateTimeline(timelineTasks, timelineProjectName);
        }
        if (typeof ganttTasks !== 'undefined' && ganttTasks && ganttTasks.length > 0) {
            renderGanttChart();
        }
        if (typeof updateAllEmbeddedTimelines === 'function') {
            updateAllEmbeddedTimelines();
        }
    }, 50);
}

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
        title: "Drag and Drop",
        message: "You can drag and drop .md or .txt files directly onto the editor to load them. Press ? at any time to see all keyboard shortcuts.",
        target: ".editor-panel",
        position: "right"
    },
    {
        title: "Resizable Editor",
        message: "Drag the splitter bar between the editor and content pane to resize the editor to your preferred width. Click the arrow button to collapse or expand the editor panel.",
        target: "#editorSplitter",
        position: "left"
    },
    {
        title: "Dashboard",
        message: "Click Dashboard to see your Project Report - an overview with timeline, task completion, milestones, highlights, and RAID summary.",
        target: "#dashboardTab",
        position: "bottom"
    },
    {
        title: "Portfolio",
        message: "The Portfolio view lets you manage all your projects in one place. Switch between Projects, Status, Resources, Timeline, Actions, Risks, and Look-Ahead views to get a cross-project overview.",
        target: "#portfolioTab",
        position: "bottom"
    },
    {
        title: "Project",
        message: "Click Project to jump to the Dashboard with a sub-navigation bar for all plan views: Tasks, Gantt chart (with baseline comparison), Calendar, Board (Kanban), Timeline, Milestones, Mind Map, and Stakeholders (with an Interest/Influence grid). Use the three-dot menu on each task row for quick actions.",
        target: "#planTab",
        position: "bottom"
    },
    {
        title: "Tracking",
        message: "Click Tracking to go straight to the RAID Log (Risks, Actions, Issues, Decisions, Dependencies) with a sub-navigation bar for Highlights, 2-Week Look-Ahead, and Analysis.",
        target: "#trackingTab",
        position: "bottom"
    },
    {
        title: "Resources",
        message: "Click Resources to open the Resource Table with a sub-navigation bar for Timesheet, User Workload, and Resource Sheet views.",
        target: "#resourcesTab",
        position: "bottom"
    },
    {
        title: "Tools Menu",
        message: "The Tools dropdown provides utilities: Text Report, Planning Room (guided plan creation), Templates, Syntax Guide, and Import/Export options including Excel, CSV, PDF, and PowerPoint. A sub-navigation bar provides quick switching between Text Report, Planning Room, and Syntax Guide.",
        target: "#toolsTab",
        position: "bottom"
    },
    {
        title: "Keyboard Shortcuts",
        message: "Press ? at any time to see all available keyboard shortcuts. Use Alt+T to quickly add a task, Alt+R for a new risk, Alt+P to jump to the portfolio, and more.",
        target: null,
        position: "center"
    },
    {
        title: "You're Ready! 🚀",
        message: "That's it! Start by creating your first task in the editor, explore the Project tab for different views, or check Tools > Syntax Guide to learn more. Press '?' at any time to see keyboard shortcuts.",
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

