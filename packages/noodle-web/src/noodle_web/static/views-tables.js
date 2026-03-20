/**
 * views-tables.js — Table rendering for milestones, tasks, resources, timesheet.
 * Depends on: state.js (globals)
 */

function updateMilestonesTable(tasks) {
    try {
        // Show milestones content, hide placeholder
        const placeholder = document.querySelector('#milestones-view .milestones-placeholder');
        const content = document.querySelector('#milestones-view .milestones-content');

        if (placeholder && content) {
            placeholder.style.display = 'none';
            content.style.display = 'block';
        }

        // Get table body and header
        const tbody = document.getElementById('milestonesTableBody');
        const thead = document.getElementById('milestonesTableHead');
        if (!tbody) {
            console.error('Milestones table body not found');
            return;
        }

        // Clear existing rows
        tbody.innerHTML = '';

        // Check if baseline columns should be shown
        const msToggle = document.getElementById('milestonesShowBaseline');
        const showBaseline = msToggle && msToggle.checked && baselineItems.length > 0;
        const baselineLookup = showBaseline ? getBaselineLookup() : {};

        // Update table header to include/exclude baseline columns
        if (thead) {
            thead.innerHTML = '';
            const headers = ['ID', 'Task Name', 'Start', 'Finish'];
            if (showBaseline) {
                headers.push('BL Start', 'BL Finish', 'Variance');
            }
            headers.push('%', 'RAG', 'Priority', 'Bucket', 'Comment');
            headers.forEach(h => {
                const th = document.createElement('th');
                th.textContent = h;
                if (h.startsWith('BL') || h === 'Variance') {
                    th.classList.add('baseline-col');
                }
                thead.appendChild(th);
            });
        }

        // Filter to only show actual milestones (0-duration, non-summary tasks)
        const filteredTasks = tasks.filter(task => {
            return task.duration_days === 0 && !task.is_summary;
        });

        // Sort milestones by finish date (earliest first)
        filteredTasks.sort((a, b) => {
            const dateA = new Date(a.finish || '9999-12-31');
            const dateB = new Date(b.finish || '9999-12-31');
            return dateA - dateB;
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

            // Baseline columns (if toggled on)
            if (showBaseline) {
                const bl = baselineLookup[task.name];
                const blStartCell = document.createElement('td');
                blStartCell.classList.add('baseline-col');
                blStartCell.textContent = bl ? (bl.start || '-') : '-';
                row.appendChild(blStartCell);

                const blFinishCell = document.createElement('td');
                blFinishCell.classList.add('baseline-col');
                blFinishCell.textContent = bl ? (bl.finish || '-') : '-';
                row.appendChild(blFinishCell);

                const varianceCell = document.createElement('td');
                varianceCell.classList.add('baseline-col');
                if (bl && bl.finish && task.finish) {
                    const currentDate = parseLocalDate(task.finish);
                    const baselineDate = parseLocalDate(bl.finish);
                    if (currentDate && baselineDate) {
                        const diffDays = Math.round((currentDate - baselineDate) / (1000 * 60 * 60 * 24));
                        if (diffDays > 0) {
                            varianceCell.textContent = '+' + diffDays + 'd';
                            varianceCell.classList.add('baseline-late');
                        } else if (diffDays < 0) {
                            varianceCell.textContent = diffDays + 'd';
                            varianceCell.classList.add('baseline-early');
                        } else {
                            varianceCell.textContent = 'On track';
                            varianceCell.classList.add('baseline-ontrack');
                        }
                    } else {
                        varianceCell.textContent = '-';
                    }
                } else {
                    varianceCell.textContent = bl ? '-' : 'New';
                    if (!bl) varianceCell.classList.add('baseline-new');
                }
                row.appendChild(varianceCell);
            }

            // Percent cell
            const percentCell = document.createElement('td');
            percentCell.textContent = task.percent || '-';
            row.appendChild(percentCell);

            // RAG cell
            const ragCell = document.createElement('td');
            const ragText = task.rag || '-';
            ragCell.textContent = ragText;
            const ragColour = ragStatusToColour(ragText);
            if (ragColour) {
                ragCell.classList.add('rag-' + ragColour);
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
            const ribbonSpan = titleEl.querySelector('.ribbon-banner');
            if (ribbonSpan) {
                ribbonSpan.textContent = projectName || 'Untitled Project';
            } else {
                titleEl.textContent = projectName || 'Untitled Project';
            }
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
        agreedBudget = parseFloat(String(budget).replace(/[^0-9.]/g, '')) || 0;
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
                const badgeColour = ragStatusToColour(status);
                if (badgeColour) {
                    badge.classList.add('rag-' + badgeColour);
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

        // Overall project RAG badge (next to date)
        const overallRAGEl = document.getElementById('reportOverallRAG');
        if (overallRAGEl) {
            // Use portfolio-status.js functions to compute RAG from tasks/front matter
            if (typeof extractRAGStatus === 'function' && typeof extractProjectStatusLabel === 'function') {
                const completion = (typeof calculateProjectCompletionFromTasks === 'function')
                    ? calculateProjectCompletionFromTasks(tasks) : 0;
                const ragStatus = extractRAGStatus(frontMatter, tasks, completion);
                const statusLabel = extractProjectStatusLabel(frontMatter, completion, ragStatus);
                overallRAGEl.textContent = statusLabel;
                overallRAGEl.className = 'report-rag-badge rag-' + ragStatus;
                overallRAGEl.style.display = '';
            } else {
                overallRAGEl.style.display = 'none';
            }
        }

        // Render simple timeline (no phases, no detailed view)
        updateReportTimeline(tasks, projectName);

        // Populate quad sections
        updateReportMilestones(tasks);
        updateReportRaid();
        updateReportUpNext(tasks);
        updateReportHighlight();
        updateReportDonutChart(tasks);

    } catch (error) {
        console.error('Error updating report page:', error);
    }
}

function updateReportTimeline(tasks, projectName) {
    try {
        const container = document.getElementById('reportSwimlaneContainer');
        if (!container) return;

        // Build swimlane data from tasks (same logic as portfolio-report.js)
        const phases = tasks.filter(t => t.is_summary && t.start && t.finish);
        const milestones = tasks.filter(t => !t.is_summary && t.duration_days === 0 && t.finish);

        if (phases.length === 0 && milestones.length === 0) {
            container.innerHTML = '<p style="color: #888; font-size: 0.9em;">No timeline data available.</p>';
            return;
        }

        // Compute date range
        let projectStart = null;
        let projectEnd = null;
        tasks.forEach(t => {
            if (t.start) {
                const s = new Date(t.start);
                if (!projectStart || s < projectStart) projectStart = s;
            }
            if (t.finish) {
                const f = new Date(t.finish);
                if (!projectEnd || f > projectEnd) projectEnd = f;
            }
        });
        if (!projectStart || !projectEnd) return;

        // 7-day padding
        const padding = 7 * 24 * 60 * 60 * 1000;
        const globalStart = new Date(projectStart.getTime() - padding);
        const globalEnd = new Date(projectEnd.getTime() + padding);

        // Build timeline data object matching renderProjectSwimlane expectations
        const timeline = {
            projectId: '',
            projectName: projectName || 'Project',
            phases: phases,
            milestones: milestones,
            startDate: projectStart,
            endDate: projectEnd
        };

        // Render using shared portfolio-timeline.js functions
        let html = '<div class="portfolio-timeline-container" style="position: relative;">';
        html += renderTimelineScale(globalStart, globalEnd, 'months');
        html += renderProjectSwimlane(timeline, globalStart, globalEnd);

        // Today marker
        const today = new Date();
        if (today >= globalStart && today <= globalEnd) {
            const todayPct = ((today - globalStart) / (globalEnd - globalStart)) * 100;
            html += '<div class="portfolio-today-line" style="left: calc(200px + (100% - 200px) * ' +
                (todayPct / 100) + ');"></div>';
        }

        html += '</div>';
        container.innerHTML = html;

    } catch (error) {
        console.error('Error updating report timeline:', error);
    }
}

function updateEmbeddedTimeline(viewId) {
    try {
        const wrapper = document.querySelector(`#${viewId} .embedded-timeline-wrapper`);
        if (!wrapper || wrapper.offsetWidth === 0) return;

        const tasks = timelineTasks;
        if (!tasks || tasks.length === 0) return;

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

        const availableWidth = wrapper.offsetWidth - 40;
        const timelineWidth = Math.max(400, availableWidth);
        const totalDays = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24)) + 1;

        const lineId = viewId + '-timeline-line';
        const milestonesId = viewId + '-timeline-milestones';

        renderMinimalTimeline(wrapper, tasks, minDate, maxDate, totalDays, timelineWidth, {
            isReport: true,
            timelineLineId: lineId,
            milestonesId: milestonesId
        });
    } catch (error) {
        console.error('Error updating embedded timeline for ' + viewId + ':', error);
    }
}

function toggleEmbeddedTimeline(viewId) {
    const section = document.querySelector(`#${viewId} .embedded-timeline-section`);
    if (!section) return;

    const isCollapsed = section.classList.toggle('collapsed');
    if (!isCollapsed) {
        setTimeout(() => updateEmbeddedTimeline(viewId), 50);
    }
}

function updateAllEmbeddedTimelines() {
    ['tasks-view', 'gantt-view'].forEach(viewId => {
        const section = document.querySelector(`#${viewId} .embedded-timeline-section`);
        if (section && !section.classList.contains('collapsed')) {
            updateEmbeddedTimeline(viewId);
        }
    });
}

function updateReportMilestones(tasks) {
    try {
        const tbody = document.getElementById('reportMilestonesTableBody');
        const emptyEl = document.getElementById('reportMilestonesEmpty');
        const tableEl = tbody ? tbody.closest('table') : null;
        if (!tbody) return;

        tbody.innerHTML = '';

        // Check if a baseline plan exists
        const hasBaseline = baselineItems.length > 0;
        const baselineLookup = hasBaseline ? getBaselineLookup() : {};

        // Update the table header to include baseline columns when baseline exists
        const thead = tableEl ? tableEl.querySelector('thead tr') : null;
        if (thead) {
            thead.innerHTML = '';
            const headers = ['Milestone', 'Date'];
            if (hasBaseline) {
                headers.push('BL Finish', 'Variance');
            }
            headers.push('RAG');
            headers.forEach(h => {
                const th = document.createElement('th');
                th.textContent = h;
                if (h === 'BL Finish' || h === 'Variance') {
                    th.classList.add('baseline-col');
                }
                thead.appendChild(th);
            });
        }

        // Filter to only milestones (0-duration, non-summary tasks)
        const allMilestones = tasks.filter(task => task.duration_days === 0 && !task.is_summary);

        // Separate incomplete from complete
        const incomplete = allMilestones
            .filter(task => (parseFloat(task.percent) || 0) < 100)
            .sort((a, b) => {
                const dateA = a.finish ? new Date(a.finish) : new Date('9999-12-31');
                const dateB = b.finish ? new Date(b.finish) : new Date('9999-12-31');
                return dateA - dateB;
            });

        const complete = allMilestones
            .filter(task => (parseFloat(task.percent) || 0) >= 100)
            .sort((a, b) => {
                const dateA = a.finish ? new Date(a.finish) : new Date('9999-12-31');
                const dateB = b.finish ? new Date(b.finish) : new Date('9999-12-31');
                return dateA - dateB;
            });

        // Include completed milestones when total milestones <= 10
        let displayMilestones;
        if (allMilestones.length <= 10) {
            // Show all milestones: incomplete first, then complete
            displayMilestones = [...incomplete, ...complete];
        } else {
            // Too many milestones: show only next 10 incomplete
            displayMilestones = incomplete.slice(0, 10);
        }

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

            // Baseline columns (shown automatically when baseline exists)
            if (hasBaseline) {
                const bl = baselineLookup[task.name];

                const blFinishCell = document.createElement('td');
                blFinishCell.classList.add('baseline-col');
                blFinishCell.textContent = bl ? (bl.finish || '-') : '-';
                row.appendChild(blFinishCell);

                const varianceCell = document.createElement('td');
                varianceCell.classList.add('baseline-col');
                if (bl && bl.finish && task.finish) {
                    const currentDate = parseLocalDate(task.finish);
                    const baselineDate = parseLocalDate(bl.finish);
                    if (currentDate && baselineDate) {
                        const diffDays = Math.round((currentDate - baselineDate) / (1000 * 60 * 60 * 24));
                        if (diffDays > 0) {
                            varianceCell.textContent = '+' + diffDays + 'd';
                            varianceCell.classList.add('baseline-late');
                        } else if (diffDays < 0) {
                            varianceCell.textContent = diffDays + 'd';
                            varianceCell.classList.add('baseline-early');
                        } else {
                            varianceCell.textContent = 'On track';
                            varianceCell.classList.add('baseline-ontrack');
                        }
                    } else {
                        varianceCell.textContent = '-';
                    }
                } else {
                    varianceCell.textContent = bl ? '-' : 'New';
                    if (!bl) varianceCell.classList.add('baseline-new');
                }
                row.appendChild(varianceCell);
            }

            const ragCell = document.createElement('td');
            const ragValue = task.rag || '-';
            ragCell.textContent = ragValue;
            const ragColourMs = ragStatusToColour(ragValue);
            if (ragColourMs) {
                ragCell.classList.add('rag-' + ragColourMs);
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
 * Populate the Up Next quad with late, in-progress, and upcoming tasks
 * for the next 2 weeks. Limited to 10 leaf tasks.
 *
 * Uses the same start/finish dates and RAG statuses already computed by
 * the scheduling engine so values are consistent with the task table.
 */
function updateReportUpNext(tasks) {
    try {
        const tbody = document.getElementById('reportUpNextTableBody');
        const emptyEl = document.getElementById('reportUpNextEmpty');
        const tableEl = document.getElementById('reportUpNextTable');
        if (!tbody) return;

        tbody.innerHTML = '';

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const twoWeeksFromNow = new Date(today);
        twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);

        // Expand recurring tasks into occurrences within the window
        // generateRecurrenceOccurrences is defined in script.js
        const allTasks = [...tasks];
        if (typeof generateRecurrenceOccurrences === 'function') {
            tasks.forEach(task => {
                if (task.recurrence && !task.is_summary) {
                    const occurrences = generateRecurrenceOccurrences(task, today, twoWeeksFromNow);
                    occurrences.forEach(occ => allTasks.push(occ));
                }
            });
        }

        // Filter to leaf tasks only (non-summary, non-milestone, with dates)
        const leafTasks = allTasks.filter(t =>
            !t.is_summary &&
            (t.duration_days !== 0 || t.is_recurring_instance) &&
            (t.start || t.is_recurring_instance) && (t.finish || t.is_recurring_instance)
        );

        const categorized = [];

        leafTasks.forEach(task => {
            const percent = parseFloat(task.percent) || 0;

            // For recurring instances, use recurrence_date
            const taskStart = task.is_recurring_instance ? task.recurrence_date : task.start;
            const taskFinish = task.is_recurring_instance ? task.recurrence_date : task.finish;

            if (!taskStart && !taskFinish) return;
            if (percent >= 100 && !task.is_recurring_instance) return;

            const startDate = taskStart ? parseLocalDate(taskStart) : null;
            const finishDate = taskFinish ? parseLocalDate(taskFinish) : null;

            // Recurring instances always show as upcoming if within window
            if (task.is_recurring_instance) {
                const occDate = parseLocalDate(task.recurrence_date);
                if (occDate >= today && occDate <= twoWeeksFromNow) {
                    categorized.push({ task, sortOrder: 2, status: 'Recurring', statusClass: 'rag-green', displayStart: taskStart, displayFinish: taskFinish });
                }
                return;
            }

            const isLate = finishDate && finishDate < today && percent < 100;
            const isInProgress = percent > 0 && percent < 100;
            const isUpcoming = startDate && startDate <= twoWeeksFromNow && startDate >= today && percent === 0;

            // Use the RAG status from the scheduling engine for consistency
            // with the task table, falling back to a derived value only if
            // the backend did not provide one.
            const ragStatus = task.rag || '';
            const ragColourCat = ragStatusToColour(ragStatus);
            const ragClass = ragColourCat ? 'rag-' + ragColourCat : '';

            if (isLate) {
                categorized.push({ task, sortOrder: 0, status: ragStatus || 'Task Overdue', statusClass: ragClass || 'rag-red', displayStart: taskStart, displayFinish: taskFinish });
            } else if (isInProgress) {
                categorized.push({ task, sortOrder: 1, status: ragStatus || 'Behind Schedule', statusClass: ragClass || 'rag-amber', displayStart: taskStart, displayFinish: taskFinish });
            } else if (isUpcoming) {
                categorized.push({ task, sortOrder: 2, status: ragStatus || 'Not Started', statusClass: ragClass || 'rag-green', displayStart: taskStart, displayFinish: taskFinish });
            }
        });

        // Sort by task start date ascending (earliest first)
        categorized.sort((a, b) => {
            const dateA = a.displayStart ? parseLocalDate(a.displayStart) : parseLocalDate(a.task.start);
            const dateB = b.displayStart ? parseLocalDate(b.displayStart) : parseLocalDate(b.task.start);
            return dateA - dateB;
        });

        const displayTasks = categorized.slice(0, 10);

        if (displayTasks.length === 0) {
            if (tableEl) tableEl.style.display = 'none';
            if (emptyEl) emptyEl.style.display = 'block';
            return;
        }

        if (tableEl) tableEl.style.display = '';
        if (emptyEl) emptyEl.style.display = 'none';

        displayTasks.forEach(({ task, status, statusClass, displayStart, displayFinish }) => {
            const row = document.createElement('tr');
            row.classList.add('up-next-row-clickable');
            row.addEventListener('click', () => {
                switchTab('editor');
                openTaskFormByName(task.name);
            });

            const nameCell = document.createElement('td');
            nameCell.classList.add('task-name');
            const nameText = document.createTextNode(task.name);
            nameCell.appendChild(nameText);
            if (task.recurrence) {
                const badge = document.createElement('span');
                badge.className = 'recurrence-badge';
                const label = (typeof formatRecurrenceLabel === 'function') ? formatRecurrenceLabel(task.recurrence) : task.recurrence;
                badge.textContent = label;
                nameCell.appendChild(badge);
            }
            row.appendChild(nameCell);

            const startCell = document.createElement('td');
            startCell.textContent = displayStart || task.start || '-';
            row.appendChild(startCell);

            const finishCell = document.createElement('td');
            finishCell.textContent = displayFinish || task.finish || '-';
            row.appendChild(finishCell);

            const statusCell = document.createElement('td');
            const statusBadge = document.createElement('span');
            statusBadge.className = 'up-next-status ' + statusClass;
            statusBadge.textContent = status;
            statusCell.appendChild(statusBadge);
            row.appendChild(statusCell);

            tbody.appendChild(row);
        });

    } catch (error) {
        console.error('Error updating report up next:', error);
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

        // Find the most recent highlight by date, tracking its index
        let latestIndex = 0;
        const latest = highlightsData.reduce((newest, current, idx) => {
            if (!newest) { latestIndex = idx; return current; }
            if (current.date > newest.date) {
                latestIndex = idx;
                return current;
            }
            return newest;
        }, null);

        container.innerHTML = '';

        const card = document.createElement('div');
        card.className = 'report-highlight-card clickable';
        card.title = 'Click to edit this highlight';
        card.addEventListener('click', () => editHighlight(latestIndex));

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

function updateReportDonutChart(tasks) {
    try {
        const container = document.getElementById('reportDonutChart');
        if (!container) return;

        // Filter: exclude summary tasks, include milestones and regular tasks
        const countableTasks = tasks.filter(t => !t.is_summary);

        const total = countableTasks.length;
        if (total === 0) {
            container.innerHTML = '<p class="quad-empty-state">No tasks to display.</p>';
            return;
        }

        const completedCount = countableTasks.filter(t => (parseFloat(t.percent) || 0) >= 100).length;
        const incompleteCount = total - completedCount;

        const svgNS = 'http://www.w3.org/2000/svg';
        const size = 100;
        const cx = size / 2;
        const cy = size / 2;
        const outerRadius = 45;
        const innerRadius = 29;

        const completedColor = '#90EE90';
        const incompleteColor = '#D3D3D3';

        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', size);
        svg.setAttribute('height', size);
        svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
        svg.classList.add('donut-chart-svg');

        // Helper: create an arc path
        function describeArc(cx, cy, outerR, innerR, startAngle, endAngle) {
            // Angles in radians, 0 = top (12 o'clock), clockwise
            const startOuter = polarToCartesian(cx, cy, outerR, startAngle);
            const endOuter = polarToCartesian(cx, cy, outerR, endAngle);
            const startInner = polarToCartesian(cx, cy, innerR, endAngle);
            const endInner = polarToCartesian(cx, cy, innerR, startAngle);

            const largeArc = (endAngle - startAngle) > Math.PI ? 1 : 0;

            return [
                'M', startOuter.x, startOuter.y,
                'A', outerR, outerR, 0, largeArc, 1, endOuter.x, endOuter.y,
                'L', startInner.x, startInner.y,
                'A', innerR, innerR, 0, largeArc, 0, endInner.x, endInner.y,
                'Z'
            ].join(' ');
        }

        function polarToCartesian(cx, cy, r, angle) {
            // angle: 0 = top, clockwise
            return {
                x: cx + r * Math.sin(angle),
                y: cy - r * Math.cos(angle)
            };
        }

        if (completedCount === total) {
            // All complete - full ring with draw animation
            const ringRadius = (outerRadius + innerRadius) / 2;
            const circumference = 2 * Math.PI * ringRadius;
            const circle = document.createElementNS(svgNS, 'circle');
            circle.setAttribute('cx', cx);
            circle.setAttribute('cy', cy);
            circle.setAttribute('r', ringRadius);
            circle.setAttribute('fill', 'none');
            circle.setAttribute('stroke', completedColor);
            circle.setAttribute('stroke-width', outerRadius - innerRadius);
            circle.classList.add('donut-ring-animated');
            circle.style.setProperty('--circumference', circumference);
            circle.setAttribute('stroke-dasharray', circumference);
            circle.setAttribute('stroke-dashoffset', '0');
            circle.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);
            svg.appendChild(circle);
        } else if (incompleteCount === total) {
            // All incomplete - full ring with draw animation
            const ringRadius = (outerRadius + innerRadius) / 2;
            const circumference = 2 * Math.PI * ringRadius;
            const circle = document.createElementNS(svgNS, 'circle');
            circle.setAttribute('cx', cx);
            circle.setAttribute('cy', cy);
            circle.setAttribute('r', ringRadius);
            circle.setAttribute('fill', 'none');
            circle.setAttribute('stroke', incompleteColor);
            circle.setAttribute('stroke-width', outerRadius - innerRadius);
            circle.classList.add('donut-ring-animated');
            circle.style.setProperty('--circumference', circumference);
            circle.setAttribute('stroke-dasharray', circumference);
            circle.setAttribute('stroke-dashoffset', '0');
            circle.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);
            svg.appendChild(circle);
        } else {
            // Draw completed slice first (starts at top)
            const completedAngle = (completedCount / total) * 2 * Math.PI;

            const completedPath = document.createElementNS(svgNS, 'path');
            completedPath.setAttribute('d', describeArc(cx, cy, outerRadius, innerRadius, 0, completedAngle));
            completedPath.setAttribute('fill', completedColor);
            completedPath.classList.add('donut-arc');
            completedPath.style.animationDelay = '0s';
            svg.appendChild(completedPath);

            // Draw incomplete slice
            const incompletePath = document.createElementNS(svgNS, 'path');
            incompletePath.setAttribute('d', describeArc(cx, cy, outerRadius, innerRadius, completedAngle, 2 * Math.PI));
            incompletePath.setAttribute('fill', incompleteColor);
            incompletePath.classList.add('donut-arc');
            incompletePath.style.animationDelay = '0.1s';
            svg.appendChild(incompletePath);
        }

        // Center text: total number
        const totalText = document.createElementNS(svgNS, 'text');
        totalText.setAttribute('x', cx);
        totalText.setAttribute('y', cy - 3);
        totalText.setAttribute('text-anchor', 'middle');
        totalText.setAttribute('dominant-baseline', 'central');
        totalText.setAttribute('font-size', '16');
        totalText.setAttribute('font-weight', '700');
        totalText.setAttribute('fill', '#333');
        totalText.classList.add('donut-center-text');
        totalText.textContent = total;
        svg.appendChild(totalText);

        const totalLabel = document.createElementNS(svgNS, 'text');
        totalLabel.setAttribute('x', cx);
        totalLabel.setAttribute('y', cy + 10);
        totalLabel.setAttribute('text-anchor', 'middle');
        totalLabel.setAttribute('dominant-baseline', 'central');
        totalLabel.setAttribute('font-size', '7');
        totalLabel.setAttribute('fill', '#888');
        totalLabel.classList.add('donut-center-text');
        totalLabel.textContent = 'tasks';
        svg.appendChild(totalLabel);

        // Build legend
        const legend = document.createElement('div');
        legend.className = 'donut-chart-legend';

        function createLegendItem(label, count, swatchClass) {
            const item = document.createElement('div');
            item.className = 'donut-legend-item';

            const swatch = document.createElement('span');
            swatch.className = 'donut-legend-swatch ' + swatchClass;
            item.appendChild(swatch);

            const countSpan = document.createElement('span');
            countSpan.className = 'donut-legend-count';
            countSpan.textContent = count;
            item.appendChild(countSpan);

            const labelSpan = document.createElement('span');
            labelSpan.textContent = label;
            item.appendChild(labelSpan);

            return item;
        }

        legend.appendChild(createLegendItem('Complete', completedCount, 'complete'));
        legend.appendChild(createLegendItem('Incomplete', incompleteCount, 'incomplete'));

        // Render
        container.innerHTML = '';
        container.appendChild(svg);
        container.appendChild(legend);

    } catch (error) {
        console.error('Error updating report donut chart:', error);
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
    // Use negative lookbehind to avoid matching inside email addresses (e.g. user@oldname)
    content = content.replace(
        new RegExp(`(?<!\\w)(@${oldShortname})(\\s*:)`, 'gi'),
        `@${newShortname}$2`
    );

    // Replace @oldname references in task lines (not in front matter definition)
    // Match @oldname followed by word boundary (space, comma, bracket, end of line)
    // Use negative lookbehind to avoid matching inside email addresses
    content = content.replace(
        new RegExp(`(?<!\\w)@${oldShortname}\\b`, 'g'),
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
    // Use negative lookbehind to avoid matching inside email addresses (e.g. user@example.com)
    content = content.replace(/(?<!\w)@([a-z])(\w*)/g, (match, firstChar, rest) => {
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

        // Parse holidays and non-working days from front matter
        const holidays = [];
        for (const fmKey of ['holidays', 'non-working-days']) {
            if (frontMatter[fmKey]) {
                const val = typeof frontMatter[fmKey] === 'string' ? frontMatter[fmKey] : '';
                const dateMatches = val.match(/\d{4}-\d{2}-\d{2}/g);
                if (dateMatches) {
                    dateMatches.forEach(d => { if (!holidays.includes(d)) holidays.push(d); });
                }
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

function updateTasksTable(tasks) {
    const placeholder = document.querySelector('#tasks-view .placeholder-view');
    const content = document.querySelector('#tasks-view .tasks-content');

    if (placeholder && content) {
        placeholder.style.display = 'none';
        content.style.display = 'block';
    }

    const tbody = document.getElementById('tasksTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!tasks || tasks.length === 0) return;

    const nameToId = buildTaskNameToIdMap(tasks);

    tasks.forEach((task, index) => {
        const cfStyle = !task.is_summary ? getConditionalFormatting(task) : null;

        const row = document.createElement('tr');
        row.dataset.taskIndex = index;
        if (task.is_summary) row.classList.add('gantt-phase-row');
        if (cfStyle) {
            row.style.backgroundColor = cfStyle.backgroundColor;
            row.style.color = cfStyle.color;
        }

        // Done piechart
        const doneCell = document.createElement('td');
        doneCell.classList.add('gantt-done-cell');
        if (!task.is_summary) {
            const percent = parseFloat(task.percent) || 0;
            const piechart = createMiniPiechart(percent, (newPercent) => {
                task.percent = newPercent;
                syncGanttPercentToEditor(task, index);
            });
            doneCell.appendChild(piechart);
        }
        row.appendChild(doneCell);

        // ID
        const idCell = document.createElement('td');
        idCell.textContent = task.id;
        row.appendChild(idCell);

        // Task Name with context menu button
        const nameCell = document.createElement('td');
        nameCell.classList.add('editable', 'task-name-cell');
        nameCell.dataset.field = 'name';
        nameCell.style.position = 'relative';
        const indent = '  '.repeat(task.level);
        const taskNameSpan = document.createElement('span');
        taskNameSpan.classList.add('task-name-text');
        taskNameSpan.style.whiteSpace = 'pre';
        if (task.is_summary) {
            taskNameSpan.style.fontWeight = '600';
        }
        taskNameSpan.textContent = indent + task.name;
        nameCell.appendChild(taskNameSpan);
        const contextBtn = createTaskContextButton(task, index);
        nameCell.appendChild(contextBtn);
        nameCell.addEventListener('dblclick', () => makeEditable(nameCell, task, index));
        row.appendChild(nameCell);

        // Duration
        const durationCell = document.createElement('td');
        durationCell.classList.add('editable');
        durationCell.dataset.field = 'duration';
        durationCell.textContent = task.duration_days ? `${task.duration_days}d` : '-';
        durationCell.addEventListener('dblclick', () => makeEditable(durationCell, task, index));
        row.appendChild(durationCell);

        // Start
        const startCell = document.createElement('td');
        startCell.classList.add('editable');
        startCell.dataset.field = 'start';
        startCell.textContent = task.start || '-';
        startCell.addEventListener('dblclick', () => makeEditable(startCell, task, index));
        row.appendChild(startCell);

        // Finish
        const finishCell = document.createElement('td');
        finishCell.classList.add('editable');
        finishCell.dataset.field = 'finish';
        finishCell.textContent = task.finish || '-';
        finishCell.addEventListener('dblclick', () => makeEditable(finishCell, task, index));
        row.appendChild(finishCell);

        // Resources
        const resourcesCell = document.createElement('td');
        resourcesCell.classList.add('editable');
        resourcesCell.dataset.field = 'resources';
        resourcesCell.textContent = task.resources || '-';
        if (task.inherited_resource) {
            resourcesCell.style.fontStyle = 'italic';
            resourcesCell.title = 'Inherited from parent summary task';
        }
        resourcesCell.addEventListener('dblclick', () => makeEditable(resourcesCell, task, index));
        row.appendChild(resourcesCell);

        // Percent
        const percentCell = document.createElement('td');
        percentCell.classList.add('editable');
        percentCell.dataset.field = 'percent';
        percentCell.textContent = task.percent ? `${String(task.percent).replace('%', '')}%` : '-';
        percentCell.addEventListener('dblclick', () => makeEditable(percentCell, task, index));
        row.appendChild(percentCell);

        // Effort
        const effortCell = document.createElement('td');
        if (task.effort_total) {
            const completed = parseFloat(task.effort_completed) || 0;
            const total = parseFloat(task.effort_total) || 0;
            const unit = task.effort_total_unit || 'h';
            if (completed > 0) {
                effortCell.textContent = `${completed}${task.effort_completed_unit || unit}/${total}${unit}`;
            } else {
                effortCell.textContent = `${total}${unit}`;
            }
        } else {
            effortCell.textContent = '-';
        }
        row.appendChild(effortCell);

        // RAG
        const ragCell = document.createElement('td');
        ragCell.classList.add('gantt-rag-cell');
        if (task.rag) {
            const printRagColour = ragStatusToColour(task.rag);
            const ragDot = document.createElement('span');
            ragDot.className = 'gantt-rag-dot' + (printRagColour ? ' rag-' + printRagColour : '');
            ragDot.title = task.rag;
            ragCell.appendChild(ragDot);
        } else {
            ragCell.textContent = '-';
        }
        row.appendChild(ragCell);

        // Priority
        const priorityCell = document.createElement('td');
        priorityCell.classList.add('editable');
        priorityCell.dataset.field = 'priority';
        const priorityValue = task.priority || 'Low';
        priorityCell.textContent = priorityValue;
        if (priorityValue === 'Urgent') priorityCell.classList.add('priority-urgent');
        else if (priorityValue === 'Important') priorityCell.classList.add('priority-important');
        else if (priorityValue === 'Medium') priorityCell.classList.add('priority-medium');
        priorityCell.addEventListener('dblclick', () => makePriorityEditable(priorityCell, task, index));
        row.appendChild(priorityCell);

        // Bucket (dropdown)
        const bucketCell = document.createElement('td');
        bucketCell.classList.add('editable');
        bucketCell.dataset.field = 'bucket';
        bucketCell.textContent = task.bucket || '-';
        bucketCell.addEventListener('dblclick', () => makeBucketEditable(bucketCell, task, index));
        row.appendChild(bucketCell);

        // Comment
        const commentCell = document.createElement('td');
        commentCell.classList.add('editable');
        commentCell.dataset.field = 'comment';
        commentCell.textContent = task.comment || '-';
        commentCell.addEventListener('dblclick', () => makeEditable(commentCell, task, index));
        row.appendChild(commentCell);

        // Predecessors
        const predCell = document.createElement('td');
        predCell.classList.add('editable');
        predCell.dataset.field = 'predecessors';
        const predText = formatPredecessors(task, nameToId);
        predCell.textContent = predText || '-';
        predCell.addEventListener('dblclick', () => makeEditable(predCell, task, index));
        row.appendChild(predCell);

        // Click to open task
        row.style.cursor = 'pointer';
        row.addEventListener('click', (e) => {
            if (e.target.closest('.editable') || e.target.closest('.gantt-done-cell') || e.target.closest('.task-context-btn')) return;
            openMilestoneTaskForm(task.name);
        });

        // Right-click context menu
        row.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showTaskContextMenuAtPosition(e, task, index);
        });

        tbody.appendChild(row);
    });
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


