/**
 * views-timeline.js — Timeline rendering and date-scale helpers.
 * Depends on: state.js (globals)
 */

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
        bgRect.setAttribute('class', 'timeline-clickable timeline-phase-animated');
        bgRect.style.animationDelay = (index * 0.06) + 's';
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
            progressRect.setAttribute('class', 'timeline-clickable timeline-phase-animated');
            progressRect.style.animationDelay = (index * 0.06) + 's';
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
        text.setAttribute('class', 'timeline-phase-animated');
        text.style.animationDelay = (index * 0.06 + 0.05) + 's';
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
    const timelineLineId = options?.timelineLineId || (isReport ? 'reportTimelineLine' : 'timelineLine');
    const milestonesId = options?.milestonesId || (isReport ? 'reportTimelineMilestones' : 'timelineMilestones');

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
            rect.setAttribute('class', 'timeline-clickable timeline-phase-animated');
            rect.style.animationDelay = (index * 0.06) + 's';
            rect.style.cursor = 'pointer';

            // Add tooltip
            const title = document.createElementNS(svgNS, 'title');
            title.textContent = phase.name + ' (' + percent + '% complete)';
            rect.appendChild(title);

            // Click to open task detail view
            rect.addEventListener('click', () => openMilestoneTaskForm(phase.name));

            svg.appendChild(rect);

            // Draw green progress overlay for partially complete phases
            if (percent > 0 && percent < 100) {
                const progressWidth = (percent / 100) * width;
                const progressRect = document.createElementNS(svgNS, 'rect');
                progressRect.setAttribute('x', x);
                progressRect.setAttribute('y', y);
                progressRect.setAttribute('width', progressWidth);
                progressRect.setAttribute('height', barHeight);
                progressRect.setAttribute('rx', 2);
                progressRect.setAttribute('ry', 2);
                progressRect.setAttribute('fill', greenComplete);
                progressRect.setAttribute('opacity', '0.85');
                progressRect.setAttribute('class', 'timeline-clickable timeline-phase-animated');
                progressRect.style.animationDelay = (index * 0.06) + 's';
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
                text.setAttribute('class', 'timeline-phase-animated');
                text.style.animationDelay = (index * 0.06 + 0.05) + 's';
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
    milestones.forEach((task, index) => {
        const milestoneDate = parseLocalDate(task.finish);
        const daysFromStart = Math.floor((milestoneDate - minDate) / (1000 * 60 * 60 * 24));
        const position = (daysFromStart / totalDays) * timelineWidth;

        const percent = parseFloat(task.percent) || 0;
        const isComplete = percent >= 100;

        const milestoneDiv = document.createElement('div');
        milestoneDiv.className = 'timeline-milestone minimal-milestone timeline-milestone-animated';
        milestoneDiv.style.left = position + 'px';
        milestoneDiv.style.animationDelay = (index * 0.06) + 's';

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
            const ribbonSpan = titleElement.querySelector('.ribbon-banner');
            if (ribbonSpan) {
                ribbonSpan.textContent = `${displayName} Timeline`;
            } else {
                titleElement.textContent = `${displayName} Timeline`;
            }
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

        // No extra padding — start and end sit at the edges

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
        progressBar.className = 'timeline-progress timeline-progress-animated';
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
            milestoneDiv.className = 'timeline-milestone timeline-milestone-animated';
            milestoneDiv.style.left = position + 'px';
            milestoneDiv.style.cursor = 'pointer';
            milestoneDiv.style.animationDelay = (index * 0.06) + 's';

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

