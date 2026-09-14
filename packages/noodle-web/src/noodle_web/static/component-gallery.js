/**
 * Component gallery specification (#1193).
 *
 * One description of the app's components, consumed by two things: the
 * showcase page at /components, and the Storybook stories in .storybook/
 * (#1197). Two hand-maintained galleries drift, and the second one to drift is
 * the one nobody notices.
 *
 * Each entry is markup that uses the app's real class names against the app's
 * real stylesheets. Nothing here defines styling of its own -- if a component
 * looks wrong in the gallery, it looks wrong in the app.
 *
 * This is an ES module, imported by both consumers -- `<script type="module">`
 * on the gallery page and a Vite import in Storybook. That is the reason the
 * page's own script is a module too.
 *
 * A note on states. CSS pseudo-classes cannot be forced from script, so the
 * gallery renders live elements and you exercise :hover with the pointer and
 * :focus-visible with Tab. Only `disabled` is a real attribute and is rendered
 * directly. The mechanical assertion that every family has a visible focus
 * indicator lives in tests/ui/test_component_gallery.py, which drives a real
 * keyboard; this page is for looking at.
 */

export const GALLERY = [
    {
        id: 'buttons',
        title: 'Buttons',
        note:
            '136 differently-named button classes exist across 21 stylesheets. These are ' +
            'the canonical ones; the rest are per-view respecifications of the same ' +
            'button and are being folded in per view.',
        variants: [
            { name: 'Primary', html: '<button class="btn-primary">Save plan</button>' },
            { name: 'Secondary', html: '<button class="btn-secondary">Cancel</button>' },
            { name: 'Link', html: '<button class="btn-link">Show details</button>' },
            { name: 'Link (inline)', html: '<button class="link-button">Clear filter</button>' },
            { name: 'Primary, disabled', html: '<button class="btn-primary" disabled>Save plan</button>' },
            { name: 'Secondary, disabled', html: '<button class="btn-secondary" disabled>Cancel</button>' },
        ],
        issues: [
            '.btn-primary and .btn-secondary both carry flex: 1, so they stretch in any ' +
            'flex container they are dropped into. Correct in a modal footer, wrong ' +
            'everywhere else -- unpicking it means checking every call site.',
            '.btn-secondary is a solid Bootstrap grey (#6c757d) with no token behind it. ' +
            'What a secondary button should look like in a warm palette is a design ' +
            'decision, not a substitution.',
        ],
    },
    {
        id: 'badges',
        title: 'Badges and status',
        note:
            '114 badge class names with 3 focus rules between them. Badges are usually ' +
            'non-interactive, so that is mostly fine -- but check any that are.',
        variants: [
            { name: 'RAG red', html: '<span class="rag-badge rag-red">Red</span>' },
            { name: 'RAG amber', html: '<span class="rag-badge rag-amber">Amber</span>' },
            { name: 'RAG green', html: '<span class="rag-badge rag-green">Green</span>' },
            { name: 'Status', html: '<span class="status-badge">In progress</span>' },
            { name: 'Baseline active', html: '<span class="baseline-active-badge">Active</span>' },
            { name: 'Severity', html: '<span class="action-severity-badge">High</span>' },
        ],
    },
    {
        id: 'inputs',
        title: 'Form controls',
        note:
            'Inputs are the one family where focus is styled more often than hover ' +
            '(32 rules against 13). --np-border-control gives the resting boundary the ' +
            '3:1 contrast WCAG 2.2 SC 1.4.11 asks for.',
        variants: [
            {
                name: 'Text',
                html:
                    '<div class="form-group"><label for="g-text">Task name</label>' +
                    '<input id="g-text" type="text" value="Draft the schedule"></div>',
            },
            {
                name: 'Text, empty',
                html:
                    '<div class="form-group"><label for="g-empty">Owner</label>' +
                    '<input id="g-empty" type="text" placeholder="Unassigned"></div>',
            },
            {
                name: 'Date',
                html:
                    '<div class="form-group"><label for="g-date">Start</label>' +
                    '<input id="g-date" type="date" value="2026-09-01"></div>',
            },
            {
                name: 'Select',
                html:
                    '<div class="form-group"><label for="g-select">Priority</label>' +
                    '<select id="g-select"><option>High</option><option>Medium</option>' +
                    '<option>Low</option></select></div>',
            },
            {
                name: 'Textarea',
                html:
                    '<div class="form-group"><label for="g-area">Comment</label>' +
                    '<textarea id="g-area" rows="3">Waiting on sign-off.</textarea></div>',
            },
            {
                name: 'Disabled',
                html:
                    '<div class="form-group"><label for="g-dis">Locked field</label>' +
                    '<input id="g-dis" type="text" value="Read only" disabled></div>',
            },
            { name: 'Checkbox', html: '<label><input type="checkbox" checked> Include weekends</label>' },
            {
                name: 'Radios',
                html:
                    '<label><input type="radio" name="g-radio" checked> Day</label> ' +
                    '<label><input type="radio" name="g-radio"> Week</label>',
            },
        ],
    },
    {
        id: 'feedback',
        title: 'Feedback',
        note: 'Recovered in #1194 after rendering unstyled since the #571 CSS split.',
        variants: [
            {
                name: 'Progress toast',
                // .progress-toast is position: fixed in the app. The gallery pins it
                // into its own cell so it can be seen next to everything else.
                html:
                    '<div class="gallery-static-toast"><div class="progress-toast show">' +
                    '<div class="progress-toast-text">Capturing timelines (2/5)…</div>' +
                    '<div class="progress-toast-bar-track"><div class="progress-toast-bar-fill" ' +
                    'style="width:40%"></div></div></div></div>',
            },
            {
                name: 'Toast, succeeded',
                html:
                    '<div class="gallery-static-toast"><div class="progress-toast show progress-toast-success">' +
                    '<div class="progress-toast-text">Exported Portfolio-Report.pptx</div>' +
                    '<div class="progress-toast-bar-track"><div class="progress-toast-bar-fill" ' +
                    'style="width:100%"></div></div></div></div>',
            },
            {
                name: 'Toast, failed',
                html:
                    '<div class="gallery-static-toast"><div class="progress-toast show progress-toast-error">' +
                    '<div class="progress-toast-text">Export failed: no timelines to capture</div>' +
                    '<div class="progress-toast-bar-track"><div class="progress-toast-bar-fill" ' +
                    'style="width:100%"></div></div></div></div>',
            },
            {
                name: 'Filter notice',
                html:
                    '<div class="user-workload-filter-notice">Showing overallocated resources only.' +
                    '<button class="link-button">Show all</button></div>',
            },
            { name: 'Test status, pending', html: '<span class="ai-test-status ai-test-pending">Testing connection…</span>' },
            { name: 'Test status, success', html: '<span class="ai-test-status ai-test-success">Connection successful!</span>' },
            { name: 'Test status, error', html: '<span class="ai-test-status ai-test-error">Connection failed.</span>' },
        ],
    },
    {
        id: 'suggestions',
        title: 'Date suggestions',
        note: 'From #1161. Also recovered in #1194.',
        variants: [
            {
                name: 'Suggestion bar',
                html:
                    '<div class="task-date-suggestions active">' +
                    '<div class="task-date-suggestion">' +
                    '<span class="task-date-suggestion-label">Found “next Friday”</span>' +
                    '<button class="task-date-suggestion-btn">Set start</button>' +
                    '<button class="task-date-suggestion-btn">Set finish</button>' +
                    '<button class="task-date-suggestion-dismiss">Dismiss</button>' +
                    '</div></div>',
            },
        ],
    },
    {
        id: 'tables',
        title: 'Tables',
        note:
            'The largest family by rule count: 828 rules over 212 class names, and every ' +
            'view has its own table.',
        variants: [
            {
                name: 'Exceptions table',
                html:
                    '<table class="nwd-exceptions-table"><thead><tr><th>Date</th><th>Reason</th>' +
                    '<th class="nwd-actions-col"></th></tr></thead><tbody>' +
                    '<tr><td><input type="date" value="2026-12-25"></td>' +
                    '<td><input type="text" value="Christmas Day"></td>' +
                    '<td class="nwd-actions-col"><button class="nwd-delete-btn">×</button></td></tr>' +
                    '<tr class="nwd-blank-row"><td><input type="date"></td>' +
                    '<td><input type="text" placeholder="Add an exception…"></td>' +
                    '<td class="nwd-actions-col"><button class="nwd-delete-btn">×</button></td></tr>' +
                    '</tbody></table>',
            },
        ],
    },
    {
        id: 'dashboard',
        title: 'Dashboard (project report)',
        note:
            'The first screen a project opens to (#project-report-view in index.html). Widgets ' +
            'are rendered by JS from live plan data (views-tables.js, script.js), so the markup ' +
            'below is a static snapshot of what that code produces, with app-only onclick wiring ' +
            '(switchToView, addAction, …) left out since there is nothing here for it to call. ' +
            'RAG colours are raw hex in the app, not tokens -- see the design-system-baseline.',
        variants: [
            {
                name: 'Header (title, detail pairs, status, divider)',
                html:
                    '<div class="project-report-header">' +
                    '<h2 class="project-report-title"><span class="ribbon-banner ribbon-banner--blue">Riverside Platform Refresh</span></h2>' +
                    '<div class="project-report-details">' +
                    '<div class="project-report-detail"><span class="project-report-detail-label">Project Manager:</span>' +
                    '<span class="project-report-detail-value">Kevin McAleer</span></div>' +
                    '<div class="project-report-detail"><span class="project-report-detail-label">Sponsor:</span>' +
                    '<span class="project-report-detail-value">Katie Fox</span></div>' +
                    '<div class="project-report-detail"><span class="project-report-detail-label">Date:</span>' +
                    '<span class="project-report-detail-value">2026-09-14</span>' +
                    '<span class="report-rag-badge rag-red">At Risk</span></div>' +
                    '</div></div>',
            },
            { name: 'Status badge, On Track', html: '<span class="report-rag-badge rag-green">On Track</span>' },
            { name: 'Status badge, Behind Schedule', html: '<span class="report-rag-badge rag-amber">Behind Schedule</span>' },
            { name: 'Status badge, At Risk', html: '<span class="report-rag-badge rag-red">At Risk</span>' },
            { name: 'Status badge, Complete', html: '<span class="report-rag-badge rag-blue">Complete</span>' },
            {
                name: 'Timeline, minimal',
                html:
                    '<div class="report-timeline-wrapper minimal-timeline-mode" style="position:relative;">' +
                    '<div class="minimal-timeline-container" style="width:280px;height:16px;margin:0 auto 4px auto;">' +
                    '<svg width="280" height="16" class="minimal-timeline-svg">' +
                    '<rect x="0" y="0" width="128" height="7" rx="2" ry="2" fill="#4caf50" opacity="0.9"></rect>' +
                    '<text x="4" y="3.5" dominant-baseline="central" font-size="9px" fill="#fff" font-weight="500">✓ Discovery &amp; design</text>' +
                    '<rect x="134" y="0" width="146" height="7" rx="2" ry="2" fill="#1976d2" opacity="0.7"></rect>' +
                    '<rect x="134" y="0" width="76" height="7" rx="2" ry="2" fill="#4caf50" opacity="0.85"></rect>' +
                    '<text x="138" y="3.5" dominant-baseline="central" font-size="9px" fill="#fff" font-weight="500">Build &amp; rollout</text>' +
                    '</svg></div>' +
                    '<div class="timeline-line" style="width:280px;height:2px;background:#ccc;position:relative;">' +
                    '<div class="timeline-milestone minimal-milestone" style="left:128px;">' +
                    '<div class="minimal-milestone-marker" style="background:#28a745;" title="Design sign-off (2026-07-10)"></div></div>' +
                    '<div class="timeline-milestone minimal-milestone" style="left:268px;">' +
                    '<div class="minimal-milestone-marker" style="background:#1976d2;" title="Go live (2026-11-20)"></div></div>' +
                    '</div>' +
                    '<div class="minimal-date-scale" style="width:280px;position:relative;height:14px;">' +
                    '<span class="minimal-date-label" style="left:0;">2026-06-01</span>' +
                    '<span class="minimal-date-label minimal-date-tick" style="left:134px;">15 aug</span>' +
                    '<span class="minimal-date-label" style="left:auto;right:0;">2026-11-20</span>' +
                    '</div></div>',
            },
            {
                name: 'Task completion',
                html:
                    '<div class="donut-chart-container">' +
                    '<svg width="100" height="100" viewBox="0 0 100 100" class="donut-chart-svg">' +
                    '<path d="M 50 5 A 45 45 0 1 1 18.18 81.82 L 29.49 70.51 A 29 29 0 1 0 50 21 Z" fill="#90EE90" class="donut-arc"></path>' +
                    '<path d="M 18.18 81.82 A 45 45 0 0 1 50 5 L 50 21 A 29 29 0 0 0 29.49 70.51 Z" fill="#D3D3D3" class="donut-arc"></path>' +
                    '<text x="50" y="47" text-anchor="middle" dominant-baseline="central" font-size="16" font-weight="700" fill="#333" class="donut-center-text">24</text>' +
                    '<text x="50" y="60" text-anchor="middle" dominant-baseline="central" font-size="7" fill="#888" class="donut-center-text">tasks</text>' +
                    '</svg>' +
                    '<div class="donut-chart-legend">' +
                    '<div class="donut-legend-item"><span class="donut-legend-swatch complete"></span><span class="donut-legend-count">15</span><span>Complete</span></div>' +
                    '<div class="donut-legend-item"><span class="donut-legend-swatch incomplete"></span><span class="donut-legend-count">9</span><span>Incomplete</span></div>' +
                    '</div></div>' +
                    '<div class="completion-sparkline-container">' +
                    '<span class="sparkline-value" style="font-size:1.4em;font-weight:700;">63% complete</span>' +
                    '<svg class="completion-sparkline-svg" width="120" height="30" viewBox="0 0 120 30">' +
                    '<polyline points="0.0,27.0 30.0,21.8 60.0,11.3 90.0,6.1 120.0,3.0" fill="none" stroke="#2ca02c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>' +
                    '<circle cx="120.0" cy="3.0" r="2.5" fill="#2ca02c"></circle>' +
                    '</svg></div>',
            },
            {
                name: 'Milestones',
                html:
                    '<div class="quad-cell"><div class="quad-header"><h3>Milestones</h3></div>' +
                    '<table class="milestones-table quad-table" aria-label="Milestones">' +
                    '<thead><tr><th class="col-name">Milestone</th><th class="col-date">Date</th><th class="col-rag">RAG</th></tr></thead>' +
                    '<tbody>' +
                    '<tr><td class="task-name col-name">Design sign-off</td><td class="col-date">2026-07-10</td><td class="col-rag rag-green">Green</td></tr>' +
                    '<tr><td class="task-name col-name">Beta launch</td><td class="col-date">2026-09-30</td><td class="col-rag rag-amber">Amber</td></tr>' +
                    '<tr><td class="task-name col-name">Go live</td><td class="col-date">2026-11-20</td><td class="col-rag rag-green">Green</td></tr>' +
                    '</tbody></table></div>',
            },
            {
                name: 'Up Next',
                html:
                    '<div class="quad-cell"><div class="quad-header"><h3>Up Next</h3></div>' +
                    '<table class="milestones-table quad-table" aria-label="Up next tasks">' +
                    '<thead><tr><th class="col-name">Task</th><th class="col-date">Start</th><th class="col-date">Finish</th><th class="col-rag">RAG</th></tr></thead>' +
                    '<tbody>' +
                    '<tr class="up-next-row-clickable"><td class="task-name col-name">Finalise API contracts</td>' +
                    '<td class="col-date">2026-09-15</td><td class="col-date">2026-09-19</td>' +
                    '<td class="col-rag"><span class="up-next-status rag-red">Task Overdue</span></td></tr>' +
                    '<tr class="up-next-row-clickable"><td class="task-name col-name">User acceptance testing</td>' +
                    '<td class="col-date">2026-09-20</td><td class="col-date">2026-09-26</td>' +
                    '<td class="col-rag"><span class="up-next-status rag-amber">Behind Schedule</span></td></tr>' +
                    '<tr class="up-next-row-clickable"><td class="task-name col-name">Stakeholder demo' +
                    '<span class="recurrence-badge">Weekly</span></td>' +
                    '<td class="col-date">2026-09-28</td><td class="col-date">2026-09-28</td>' +
                    '<td class="col-rag"><span class="up-next-status rag-green">Not Started</span></td></tr>' +
                    '</tbody></table></div>',
            },
            {
                name: 'Latest Highlight',
                html:
                    '<div class="quad-cell"><div class="quad-header"><h3>Latest Highlight</h3></div>' +
                    '<div class="report-highlight-content">' +
                    '<div class="report-highlight-card clickable" title="Click to edit this highlight">' +
                    '<div class="report-highlight-meta"><span class="highlight-date">2026-09-12</span>' +
                    '<span class="highlight-author">@kevin.mcaleer</span></div>' +
                    '<div class="report-highlight-body"><p>Completed the staging environment cut-over ahead of ' +
                    'schedule. Smoke tests passing.</p></div></div></div></div>',
            },
            {
                name: 'Risks &amp; Issues',
                html:
                    '<div class="quad-cell"><div class="quad-header"><h3>Risks &amp; Issues</h3></div>' +
                    '<table class="milestones-table quad-table" aria-label="Risks and issues">' +
                    '<thead><tr><th class="col-type">Type</th><th class="col-title">Title</th><th class="col-score">Score</th></tr></thead>' +
                    '<tbody>' +
                    '<tr><td class="col-type"><span class="raid-type-badge raid-type-risk">risk</span></td>' +
                    '<td class="col-title">Vendor API rate limits may throttle nightly sync</td>' +
                    '<td class="col-score"><span class="raid-score raid-score-high">20</span></td></tr>' +
                    '<tr><td class="col-type"><span class="raid-type-badge raid-type-issue">issue</span></td>' +
                    '<td class="col-title">Staging environment intermittently unreachable</td>' +
                    '<td class="col-score"><span class="raid-score raid-score-medium">12</span></td></tr>' +
                    '<tr><td class="col-type"><span class="raid-type-badge raid-type-risk">risk</span></td>' +
                    '<td class="col-title">New starter onboarding may slip start date</td>' +
                    '<td class="col-score"><span class="raid-score raid-score-low">4</span></td></tr>' +
                    '</tbody></table></div>',
            },
            {
                name: 'Budget',
                html:
                    '<div class="quad-cell budget-widget"><div class="quad-header"><h3>Budget Summary</h3></div>' +
                    '<div class="budget-widget-content"><div class="budget-widget-cards">' +
                    '<div class="budget-widget-card"><span class="budget-widget-label">Agreed Budget</span>' +
                    '<span class="budget-widget-value">120,000.00</span></div>' +
                    '<div class="budget-widget-card"><span class="budget-widget-label">Forecast</span>' +
                    '<span class="budget-widget-value">118,500.00</span></div>' +
                    '<div class="budget-widget-card"><span class="budget-widget-label">Spend to Date</span>' +
                    '<span class="budget-widget-value">76,200.00</span></div>' +
                    '<div class="budget-widget-card"><span class="budget-widget-label">Remaining</span>' +
                    '<span class="budget-widget-value budget-under">42,300.00</span></div>' +
                    '</div><div class="budget-widget-bar-wrapper"><div class="budget-widget-bar" style="width:64%;"></div>' +
                    '</div></div></div>',
            },
            {
                name: 'Open Actions',
                html:
                    '<div class="quad-cell"><div class="quad-header"><h3>Open Actions</h3></div>' +
                    '<table class="milestones-table quad-table" aria-label="Actions summary">' +
                    '<thead><tr><th>Title</th><th>Owner</th><th>Priority</th><th>Target Date</th></tr></thead>' +
                    '<tbody>' +
                    '<tr><td>Confirm data migration window with vendor</td><td>Kevin McAleer</td>' +
                    '<td><span class="actions-priority-badge actions-priority-high">high</span></td><td>2026-09-18</td></tr>' +
                    '<tr><td>Circulate updated RAID log to steering group</td><td>Katie Fox</td>' +
                    '<td><span class="actions-priority-badge actions-priority-medium">medium</span></td><td>2026-09-22</td></tr>' +
                    '</tbody></table></div>',
            },
        ],
    },
]

/** Every token the app declares, grouped for the gallery's token tables. */
export const TOKEN_GROUPS = [
    { id: 'space', title: 'Spacing', match: /^--np-space-/, kind: 'size' },
    { id: 'text', title: 'Type scale', match: /^--np-text-\d+$/, kind: 'text' },
    { id: 'radius', title: 'Radius', match: /^--np-radius-/, kind: 'radius' },
    { id: 'elevation', title: 'Elevation', match: /^--np-elevation-/, kind: 'shadow' },
    { id: 'surface', title: 'Surfaces', match: /^--np-(paper|surface|surface-alt|sunken|selected)$/, kind: 'colour' },
    { id: 'ink', title: 'Text colour', match: /^--np-(ink|body|muted|faint)$/, kind: 'colour' },
    { id: 'accent', title: 'Accent and status', match: /^--np-(accent|accent-hover|accent-tint|accent-ink|sage|sage-tint|sage-ink|danger-tint|danger-ink)$/, kind: 'colour' },
    { id: 'line', title: 'Borders and focus', match: /^--np-(border|border-strong|border-control|hairline|focus-ring-color)$/, kind: 'colour' },
]
