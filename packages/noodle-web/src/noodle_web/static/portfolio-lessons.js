/**
 * Portfolio Lessons Learned View (issue #598)
 * Aggregates lessons captured across every project in the portfolio so the
 * organisation can see common themes, what went well, and what needs to
 * change.  Uses /api/parse via parseAllProjects() — same pattern as
 * portfolio-risks.js.
 */

function collectAllLessons(parsedProjects, impactFilter, areaFilter, phaseFilter) {
    const items = [];

    parsedProjects.forEach(({ project, parsedResult }) => {
        if (!parsedResult) return;
        const lessons = parsedResult.lessons_items || [];

        lessons.forEach(item => {
            if (!item) return;

            const impact = item.impact_type || item.impactType || '';
            const area = item.area || '';
            const phase = item.project_phase || item.projectPhase || '';

            if (impactFilter && impactFilter !== 'all' && impact !== impactFilter) return;
            if (areaFilter && areaFilter !== 'all' && area !== areaFilter) return;
            if (phaseFilter && phaseFilter !== 'all' && phase !== phaseFilter) return;

            items.push({
                projectId: project.id,
                projectName: project.name,
                lessonId: item.id,
                projectManager: item.project_manager || item.projectManager || '',
                projectType: item.project_type || item.projectType || '',
                technology: item.technology || '',
                projectPhase: phase,
                area: area,
                impactType: impact,
                observation: item.observation || '',
                impactText: item.impact || '',
                recommendations: item.recommendations || '',
                date: item.date || '',
            });
        });
    });

    items.sort((a, b) => {
        if (a.date && b.date && a.date !== b.date) return b.date.localeCompare(a.date);
        return (a.projectName || '').localeCompare(b.projectName || '');
    });

    return items;
}

async function renderPortfolioLessons() {
    const container = document.getElementById('portfolioLessonsView');
    if (!container) return;

    container.innerHTML =
        '<div class="portfolio-loading">' +
        '<div class="portfolio-loading-spinner"></div>' +
        '<p>Loading lessons learned across all projects...</p>' +
        '</div>';

    try {
        const parsedProjects = (typeof parseAllProjects === 'function')
            ? await parseAllProjects()
            : [];

        const impactFilterEl = document.getElementById('portfolioLessonsFilterImpact');
        const areaFilterEl = document.getElementById('portfolioLessonsFilterArea');
        const phaseFilterEl = document.getElementById('portfolioLessonsFilterPhase');
        const impactFilter = impactFilterEl ? impactFilterEl.value : 'all';
        const areaFilter = areaFilterEl ? areaFilterEl.value : 'all';
        const phaseFilter = phaseFilterEl ? phaseFilterEl.value : 'all';

        const items = collectAllLessons(parsedProjects, impactFilter, areaFilter, phaseFilter);

        const escapeHtml = (s) => String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

        const wentWell = items.filter(i => (i.impactType || '').toLowerCase().includes('went well')).length;
        const needsChange = items.filter(i => (i.impactType || '').toLowerCase().includes('needs')).length;
        const mixed = items.filter(i => (i.impactType || '').toLowerCase().includes('mixed')).length;

        const impactBadgeClass = (impact) => {
            const v = (impact || '').toLowerCase();
            if (v.includes('went well')) return 'lesson-impact-positive';
            if (v.includes('needs')) return 'lesson-impact-change';
            return 'lesson-impact-mixed';
        };

        const allAreas = new Set();
        const allPhases = new Set();
        parsedProjects.forEach(({ parsedResult }) => {
            (parsedResult && parsedResult.lessons_items || []).forEach(item => {
                if (item.area) allAreas.add(item.area);
                if (item.project_phase) allPhases.add(item.project_phase);
            });
        });

        const areaOptions = ['<option value="all">All</option>']
            .concat(Array.from(allAreas).sort().map(a => `<option value="${escapeHtml(a)}"${a === areaFilter ? ' selected' : ''}>${escapeHtml(a)}</option>`))
            .join('');
        const phaseOptions = ['<option value="all">All</option>']
            .concat(Array.from(allPhases).sort().map(p => `<option value="${escapeHtml(p)}"${p === phaseFilter ? ' selected' : ''}>${escapeHtml(p)}</option>`))
            .join('');

        let html = '<div class="portfolio-section">';
        html += '<h2 class="portfolio-section-title">Lessons Learned across Portfolio</h2>';
        html += '<p style="color: var(--text-muted, #999); margin: 0 0 12px 0; font-size: 0.85em;">Lessons captured by all projects, viewed through the Appreciative Inquiry lens. Use these themes to refine future ways of working.</p>';

        // Summary tiles
        html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 8px 0 14px 0;">';
        html += `<div style="padding: 10px; background: rgba(40, 167, 69, 0.1); border-left: 4px solid #28a745; border-radius: 4px;"><div style="font-size: 0.75em; text-transform: uppercase;">Went Well</div><div style="font-size: 1.6em; font-weight: 700;">${wentWell}</div></div>`;
        html += `<div style="padding: 10px; background: rgba(255, 193, 7, 0.1); border-left: 4px solid #ffc107; border-radius: 4px;"><div style="font-size: 0.75em; text-transform: uppercase;">Needs to Change</div><div style="font-size: 1.6em; font-weight: 700;">${needsChange}</div></div>`;
        html += `<div style="padding: 10px; background: rgba(108, 117, 125, 0.1); border-left: 4px solid #6c757d; border-radius: 4px;"><div style="font-size: 0.75em; text-transform: uppercase;">Mixed</div><div style="font-size: 1.6em; font-weight: 700;">${mixed}</div></div>`;
        html += `<div style="padding: 10px; background: rgba(111, 66, 193, 0.1); border-left: 4px solid #6F42C1; border-radius: 4px;"><div style="font-size: 0.75em; text-transform: uppercase;">Total Lessons</div><div style="font-size: 1.6em; font-weight: 700;">${items.length}</div></div>`;
        html += '</div>';

        // Filters
        html += '<div class="raid-toolbar" style="margin-bottom: 8px;">';
        html += '<div class="raid-filter-group"><label for="portfolioLessonsFilterImpact">Impact:</label>';
        html += `<select id="portfolioLessonsFilterImpact" onchange="renderPortfolioLessons()">
            <option value="all"${impactFilter === 'all' ? ' selected' : ''}>All</option>
            <option value="Went Well"${impactFilter === 'Went Well' ? ' selected' : ''}>Went Well</option>
            <option value="Needs to Change"${impactFilter === 'Needs to Change' ? ' selected' : ''}>Needs to Change</option>
            <option value="Mixed"${impactFilter === 'Mixed' ? ' selected' : ''}>Mixed</option>
        </select></div>`;
        html += `<div class="raid-filter-group"><label for="portfolioLessonsFilterArea">Area:</label>
            <select id="portfolioLessonsFilterArea" onchange="renderPortfolioLessons()">${areaOptions}</select></div>`;
        html += `<div class="raid-filter-group"><label for="portfolioLessonsFilterPhase">Phase:</label>
            <select id="portfolioLessonsFilterPhase" onchange="renderPortfolioLessons()">${phaseOptions}</select></div>`;
        html += '</div>';

        if (items.length === 0) {
            html += '<div class="raid-empty-state"><h3>No lessons captured yet</h3>' +
                    '<p>Lessons appear here automatically as soon as any project records them.</p>' +
                    '<p>Open a project, navigate to <strong>Tracking &gt; Lessons Learned</strong>, and add the first lesson.</p>' +
                    '</div>';
        } else {
            html += '<div class="raid-table-wrapper"><table class="raid-table" aria-label="Portfolio lessons learned">';
            html += '<thead><tr>' +
                '<th>Project</th><th>Phase</th><th>Area</th><th>Impact Type</th>' +
                '<th>Observation</th><th>Impact</th><th>Recommendations</th>' +
                '<th>PM</th><th>Date</th></tr></thead><tbody>';

            items.forEach(item => {
                html += `<tr>
                    <td>${escapeHtml(item.projectName)}</td>
                    <td>${escapeHtml(item.projectPhase)}</td>
                    <td>${escapeHtml(item.area)}</td>
                    <td><span class="raid-status-badge ${impactBadgeClass(item.impactType)}">${escapeHtml(item.impactType)}</span></td>
                    <td title="${escapeHtml(item.observation)}">${escapeHtml(item.observation)}</td>
                    <td title="${escapeHtml(item.impactText)}">${escapeHtml(item.impactText)}</td>
                    <td title="${escapeHtml(item.recommendations)}">${escapeHtml(item.recommendations)}</td>
                    <td>${escapeHtml(item.projectManager)}</td>
                    <td>${escapeHtml(item.date)}</td>
                </tr>`;
            });
            html += '</tbody></table></div>';
        }
        html += '</div>';

        container.innerHTML = html;
    } catch (error) {
        console.error('Failed to render portfolio lessons learned:', error);
        container.innerHTML = '<div class="portfolio-error"><p>Failed to load lessons learned across projects.</p></div>';
    }
}
