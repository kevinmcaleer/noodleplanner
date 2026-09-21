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
            // <np-checkbox> (#1245), the app's one checkbox. This entry used to
            // be a bare unclassed `<input type="checkbox">`, which is to say
            // the gallery declined to pick one of the app's nine treatments and
            // showed whatever the global element rule in views/gantt.css did to
            // a native control. The full state set is here because
            // `indeterminate` had no implementation anywhere in the app.
            { name: 'Checkbox', html: '<label><np-checkbox label="Include weekends"></np-checkbox> Include weekends</label>' },
            { name: 'Checkbox — checked', html: '<np-checkbox checked label="Checked"></np-checkbox>' },
            { name: 'Checkbox — mixed', html: '<np-checkbox row="summary" indeterminate label="Partly complete"></np-checkbox>' },
            { name: 'Checkbox — disabled', html: '<np-checkbox disabled label="Disabled"></np-checkbox>' },
            { name: 'Checkbox — dense', html: '<np-checkbox dense label="Dense"></np-checkbox>' },
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
                name: 'Timeline, detailed (Detailed toggle on)',
                html:
                    '<div class="report-timeline-wrapper" style="position:relative;">' +
                    '<div class="detailed-timeline-container" style="width:280px;height:32px;margin:0 auto 12px auto;">' +
                    '<svg width="280" height="32" class="detailed-timeline-svg">' +
                    '<rect x="0" y="0" width="128" height="28" rx="3" ry="3" fill="#4caf50" opacity="0.9"></rect>' +
                    '<text x="6" y="16" dominant-baseline="central" font-size="12px" fill="#fff" font-weight="600">✓ Discovery &amp; design</text>' +
                    '<rect x="134" y="0" width="146" height="28" rx="3" ry="3" fill="#1976d2" opacity="0.7"></rect>' +
                    '<rect x="134" y="0" width="76" height="28" rx="3" ry="3" fill="#0d47a1" opacity="0.9"></rect>' +
                    '<text x="140" y="16" dominant-baseline="central" font-size="12px" fill="#fff" font-weight="600">Build &amp; rollout</text>' +
                    '</svg></div>' +
                    '<div class="timeline-line-wrapper" style="position:relative;width:280px;">' +
                    '<div class="timeline-line" style="width:280px;height:6px;background:#eee;position:relative;">' +
                    '<div class="timeline-progress" style="width:63%;"></div>' +
                    '<div class="timeline-date-label timeline-start-date">2026-06-01</div>' +
                    '<div class="timeline-date-label timeline-end-date">2026-11-20</div>' +
                    '<div class="timeline-scale"><div class="timeline-scale-marker" style="left:134px;">' +
                    '<div class="timeline-scale-tick"></div><div class="timeline-scale-label">15 aug</div></div></div>' +
                    '<div class="timeline-today-marker" style="left:154px;"><div class="timeline-today-label">Today</div></div>' +
                    '</div>' +
                    '<div class="timeline-milestones" style="position:absolute;top:0;left:0;width:280px;">' +
                    '<div class="timeline-milestone" style="left:128px;"><div class="timeline-circle">' +
                    '<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#28a745" stroke="#fff" stroke-width="1"></circle>' +
                    '<path d="M6 10 L9 13 L14 7" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"></path></svg></div>' +
                    '<div class="timeline-milestone-label" style="top:75px;"><div class="milestone-name">Design sign-off</div>' +
                    '<div class="milestone-date">2026-07-10</div></div></div>' +
                    '<div class="timeline-milestone" style="left:268px;"><div class="timeline-circle">' +
                    '<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#333" stroke="#fff" stroke-width="1"></circle></svg></div>' +
                    '<div class="timeline-milestone-label" style="top:75px;"><div class="milestone-name">Go live</div>' +
                    '<div class="milestone-date">2026-11-20</div></div></div>' +
                    '</div></div></div>',
            },
            {
                name: 'Timeline, phases shown (Show Phases toggle on)',
                html:
                    '<div class="report-timeline-wrapper" style="position:relative;padding-top:100px;">' +
                    '<div class="timeline-line-wrapper" style="position:relative;width:280px;">' +
                    '<div class="timeline-line" style="width:280px;height:6px;background:#eee;position:relative;">' +
                    '<div class="timeline-progress" style="width:63%;"></div>' +
                    '<div class="timeline-date-label timeline-start-date">2026-06-01</div>' +
                    '<div class="timeline-date-label timeline-end-date">2026-11-20</div>' +
                    '<div class="timeline-scale"><div class="timeline-scale-marker" style="left:134px;">' +
                    '<div class="timeline-scale-tick"></div><div class="timeline-scale-label">15 aug</div></div></div>' +
                    '<div class="timeline-today-marker" style="left:154px;"><div class="timeline-today-label">Today</div></div>' +
                    '</div>' +
                    '<div class="timeline-milestones" style="position:absolute;top:0;left:0;width:280px;">' +
                    '<div class="timeline-milestone" style="left:128px;">' +
                    '<div class="timeline-connector" style="height:50px;bottom:10px;"></div>' +
                    '<div class="timeline-diamond phase-diamond"></div>' +
                    '<div class="timeline-milestone-label" style="bottom:70px;"><div class="milestone-name">Discovery &amp; design</div>' +
                    '<div class="milestone-date">2026-07-10</div></div></div>' +
                    '<div class="timeline-milestone" style="left:128px;"><div class="timeline-circle">' +
                    '<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#28a745" stroke="#fff" stroke-width="1"></circle>' +
                    '<path d="M6 10 L9 13 L14 7" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"></path></svg></div>' +
                    '<div class="timeline-milestone-label"><div class="milestone-name">Design sign-off</div>' +
                    '<div class="milestone-date">2026-07-10</div></div></div>' +
                    '<div class="timeline-milestone" style="left:268px;"><div class="timeline-circle">' +
                    '<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#333" stroke="#fff" stroke-width="1"></circle></svg></div>' +
                    '<div class="timeline-milestone-label"><div class="milestone-name">Go live</div>' +
                    '<div class="milestone-date">2026-11-20</div></div></div>' +
                    '</div></div></div>',
            },
            {
                name: 'Timeline, today marker hidden (Today toggle off)',
                html:
                    '<div class="report-timeline-wrapper" style="position:relative;padding-top:50px;">' +
                    '<div class="timeline-line-wrapper" style="position:relative;width:280px;">' +
                    '<div class="timeline-line" style="width:280px;height:6px;background:#eee;position:relative;">' +
                    '<div class="timeline-progress" style="width:63%;"></div>' +
                    '<div class="timeline-date-label timeline-start-date">2026-06-01</div>' +
                    '<div class="timeline-date-label timeline-end-date">2026-11-20</div>' +
                    '<div class="timeline-scale"><div class="timeline-scale-marker" style="left:134px;">' +
                    '<div class="timeline-scale-tick"></div><div class="timeline-scale-label">15 aug</div></div></div>' +
                    '</div>' +
                    '<div class="timeline-milestones" style="position:absolute;top:0;left:0;width:280px;">' +
                    '<div class="timeline-milestone" style="left:128px;"><div class="timeline-circle">' +
                    '<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#28a745" stroke="#fff" stroke-width="1"></circle>' +
                    '<path d="M6 10 L9 13 L14 7" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"></path></svg></div>' +
                    '<div class="timeline-milestone-label"><div class="milestone-name">Design sign-off</div>' +
                    '<div class="milestone-date">2026-07-10</div></div></div>' +
                    '<div class="timeline-milestone" style="left:268px;"><div class="timeline-circle">' +
                    '<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#333" stroke="#fff" stroke-width="1"></circle></svg></div>' +
                    '<div class="timeline-milestone-label"><div class="milestone-name">Go live</div>' +
                    '<div class="milestone-date">2026-11-20</div></div></div>' +
                    '</div></div></div>',
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
    {
        id: 'tasks',
        title: 'Tasks table',
        note:
            'The Tasks view (#tasks-view) and the left-hand panel of the Gantt view both render this ' +
            'same `.gantt-info-table` markup (updateTasksTable() in views-tables.js) — Gantt just adds ' +
            'the chart panel shown in the Gantt section below. Columns trimmed to the load-bearing ones ' +
            'for gallery width; the real table has 16, including a drag handle, a done piechart, ' +
            'Resources, Effort, Priority, Bucket, Comment and Predecessors.',
        variants: [
            {
                name: 'Task rows',
                html:
                    '<div style="overflow-x:auto;max-width:100%;">' +
                    '<table class="gantt-info-table tasks-table">' +
                    '<thead><tr><th>ID</th><th>Task Name</th><th>Duration</th><th>Start</th><th>Finish</th>' +
                    '<th>%</th><th>RAG</th><th>Float</th></tr></thead>' +
                    '<tbody>' +
                    '<tr class="gantt-phase-row"><td>1</td>' +
                    '<td class="task-name-cell"><span class="task-name-text">Discovery &amp; design</span></td>' +
                    '<td>30d</td><td>2026-06-01</td><td>2026-07-10</td><td>100%</td>' +
                    '<td class="gantt-rag-cell"><span class="gantt-rag-dot rag-green"></span></td>' +
                    '<td class="gantt-float-cell">0d</td></tr>' +
                    '<tr><td>2</td>' +
                    '<td class="task-name-cell"><span class="task-name-text">&nbsp;&nbsp;Wireframes</span></td>' +
                    '<td>10d</td><td>2026-06-01</td><td>2026-06-12</td><td>100%</td>' +
                    '<td class="gantt-rag-cell"><span class="gantt-rag-dot rag-green"></span></td>' +
                    '<td class="gantt-float-cell">0d</td></tr>' +
                    '<tr><td>3</td>' +
                    '<td class="task-name-cell"><span class="task-name-text">&nbsp;&nbsp;Stakeholder sign-off</span></td>' +
                    '<td>0d</td><td>2026-07-10</td><td>2026-07-10</td><td>100%</td>' +
                    '<td class="gantt-rag-cell"><span class="gantt-rag-dot rag-green"></span></td>' +
                    '<td class="gantt-float-cell">0d</td></tr>' +
                    '<tr><td>4</td>' +
                    '<td class="task-name-cell"><span class="task-name-text">&nbsp;&nbsp;Build integration</span></td>' +
                    '<td>20d</td><td>2026-07-15</td><td>2026-08-12</td><td>40%</td>' +
                    '<td class="gantt-rag-cell"><span class="gantt-rag-dot rag-red"></span></td>' +
                    '<td class="gantt-float-cell gantt-critical-float">0d</td></tr>' +
                    '</tbody></table></div>',
            },
        ],
    },
    {
        id: 'gantt',
        title: 'Gantt chart',
        note:
            'The Gantt view (#gantt-view) is the Tasks table (above) plus this chart panel ' +
            '(`static/views-gantt.js`), split by a draggable `.gantt-splitter`. Dependencies ' +
            '(#ganttShowDependencies), critical path (#ganttShowCriticalPath) and baseline ' +
            '(#ganttShowBaseline) are three independent toggles, driven from the Gantt Tools ' +
            'ribbon and backed by hidden inputs in the view (#1287) — each variant ' +
            'below isolates one against the same three rows (one phase, two tasks).',
        variants: [
            {
                name: 'Bars',
                html:
                    '<div style="overflow-x:auto;max-width:100%;"><div style="width:320px;">' +
                    '<div class="gantt-bar-row"><div class="gantt-bar gantt-phase-bar" style="left:0;width:140px;"></div></div>' +
                    '<div class="gantt-bar-row"><div class="gantt-bar gantt-task-bar" style="left:0;width:70px;"></div></div>' +
                    '<div class="gantt-bar-row"><div class="gantt-bar gantt-task-bar gantt-bar-amber" style="left:150px;width:120px;"></div></div>' +
                    '</div></div>',
            },
            {
                name: 'Dependencies shown (Show Dependencies toggle on)',
                html:
                    '<div style="overflow-x:auto;max-width:100%;"><div style="width:320px;position:relative;">' +
                    '<div class="gantt-bar-row"><div class="gantt-bar gantt-phase-bar" style="left:0;width:140px;"></div></div>' +
                    '<div class="gantt-bar-row"><div class="gantt-bar gantt-task-bar" style="left:0;width:70px;"></div></div>' +
                    '<div class="gantt-bar-row"><div class="gantt-bar gantt-task-bar gantt-bar-amber" style="left:150px;width:120px;"></div></div>' +
                    '<svg width="320" height="120" style="position:absolute;top:0;left:0;pointer-events:none;">' +
                    '<path d="M 70 60 L 110 60 L 110 100 L 145 100" fill="none" stroke="#adb5bd" stroke-width="1.5" stroke-dasharray="4,3"></path>' +
                    '<polygon points="150,100 145,95 145,105" fill="#adb5bd"></polygon>' +
                    '</svg></div></div>',
            },
            {
                name: 'Critical path shown (Critical Path toggle on)',
                html:
                    '<div style="overflow-x:auto;max-width:100%;"><div style="width:320px;position:relative;">' +
                    '<div class="gantt-bar-row"><div class="gantt-bar gantt-phase-bar" style="left:0;width:140px;"></div></div>' +
                    '<div class="gantt-bar-row"><div class="gantt-bar gantt-task-bar" style="left:0;width:70px;"></div></div>' +
                    '<div class="gantt-bar-row gantt-critical-row"><div class="gantt-bar gantt-task-bar gantt-critical-bar" style="left:150px;width:120px;">' +
                    '<div class="gantt-float-bar" style="left:120px;right:auto;width:20px;"></div></div></div>' +
                    '<svg width="320" height="120" style="position:absolute;top:0;left:0;pointer-events:none;">' +
                    '<path d="M 70 60 L 110 60 L 110 100 L 145 100" fill="none" stroke="#d32f2f" stroke-width="2"></path>' +
                    '<polygon points="150,100 145,95 145,105" fill="#d32f2f"></polygon>' +
                    '</svg></div></div>',
            },
            {
                name: 'Baseline shown (Show Baseline toggle on)',
                html:
                    '<div style="overflow-x:auto;max-width:100%;"><div style="width:320px;">' +
                    '<div class="gantt-bar-row"><div class="gantt-bar gantt-phase-bar" style="left:0;width:140px;"></div></div>' +
                    '<div class="gantt-bar-row"><div class="gantt-bar gantt-task-bar" style="left:0;width:70px;"></div>' +
                    '<div class="gantt-bar gantt-baseline-bar" style="left:0;width:70px;"></div></div>' +
                    '<div class="gantt-bar-row"><div class="gantt-bar gantt-task-bar gantt-bar-amber" style="left:150px;width:120px;"></div>' +
                    '<div class="gantt-bar gantt-baseline-bar" style="left:150px;width:90px;"></div></div>' +
                    '</div></div>',
            },
        ],
    },
    {
        id: 'icons-sprite',
        title: 'Icons — sprite',
        note:
            "The app's primary, live icon system: 49 feather-style symbols defined once " +
            'in templates/_icon_sprite.html and consumed everywhere via ' +
            '&lt;svg class="icon"&gt;&lt;use href="#icon-name"/&gt;&lt;/svg&gt; -- the ' +
            "ribbon's own icon() helper (ribbon.js) emits exactly this markup. This is " +
            'what &lt;np-button&gt;\'s slot="icon" content and icon-only mode are built ' +
            'against; the Bootstrap Icons and glyph sections below are the legacy tail, not new-icon sources.',
        variants: [
            { name: 'project report', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-project-report"/></svg>' },
            { name: 'task list', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-task-list"/></svg>' },
            { name: 'board', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-board"/></svg>' },
            { name: 'calendar', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-calendar"/></svg>' },
            { name: 'timeline', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-timeline"/></svg>' },
            { name: 'resources', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-resources"/></svg>' },
            { name: 'raid log', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-raid-log"/></svg>' },
            { name: 'highlights', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-highlights"/></svg>' },
            { name: 'milestones', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-milestones"/></svg>' },
            { name: 'gantt chart', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-gantt-chart"/></svg>' },
            { name: 'portfolio', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-portfolio"/></svg>' },
            { name: 'mind map', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-mind-map"/></svg>' },
            { name: 'whiteboard', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-whiteboard"/></svg>' },
            { name: 'pbs', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-pbs"/></svg>' },
            { name: 'deliverables', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-deliverables"/></svg>' },
            { name: 'evm', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-evm"/></svg>' },
            { name: 'stakeholders', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-stakeholders"/></svg>' },
            { name: 'benefits', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-benefits"/></svg>' },
            { name: 'add', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-add"/></svg>' },
            { name: 'delete', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-delete"/></svg>' },
            { name: 'indent', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-indent"/></svg>' },
            { name: 'outdent', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-outdent"/></svg>' },
            { name: 'link', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-link"/></svg>' },
            { name: 'unlink', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-unlink"/></svg>' },
            { name: 'filter', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-filter"/></svg>' },
            { name: 'sort', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-sort"/></svg>' },
            { name: 'print', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-print"/></svg>' },
            { name: 'home', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-home"/></svg>' },
            { name: 'save', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-save"/></svg>' },
            { name: 'upload', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-upload"/></svg>' },
            { name: 'download', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-download"/></svg>' },
            { name: 'search', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-search"/></svg>' },
            { name: 'settings', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-settings"/></svg>' },
            { name: 'refresh', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-refresh"/></svg>' },
            { name: 'flag', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-flag"/></svg>' },
            { name: 'target', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-target"/></svg>' },
            { name: 'people', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-people"/></svg>' },
            { name: 'doc', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-doc"/></svg>' },
            { name: 'chart', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-chart"/></svg>' },
            { name: 'warn', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-warn"/></svg>' },
            { name: 'bulb', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-bulb"/></svg>' },
            { name: 'grid', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-grid"/></svg>' },
            { name: 'clock', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-clock"/></svg>' },
            { name: 'money', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-money"/></svg>' },
            { name: 'check', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-check"/></svg>' },
            { name: 'pin', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-pin"/></svg>' },
            { name: 'robot', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-robot"/></svg>' },
            { name: 'monitor', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-monitor"/></svg>' },
            { name: 'external', html: '<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-external"/></svg>' },
        ],
    },
    {
        id: 'icons-bootstrap',
        title: 'Icons — Bootstrap Icons',
        note:
            "34 distinct classes in current use, loaded via CDN (bootstrap-icons@1.11.3). " +
            'Confined to Project Settings, AI Settings/Chat, export/import menus and ' +
            'Version History -- legacy chrome from before the sprite existed, not a second ' +
            'live icon system to keep drawing from. New icon-only/icon+label buttons should ' +
            "use the sprite (above) unless they sit inside one of these existing screens.",
        variants: [
            { name: 'gear', html: '<i class="bi bi-gear" style="font-size:20px;" aria-hidden="true"></i>', note: 'Project Settings' },
            { name: 'robot', html: '<i class="bi bi-robot" style="font-size:20px;" aria-hidden="true"></i>', note: 'AI Settings / AI Chat' },
            { name: 'filetype-xlsx', html: '<i class="bi bi-filetype-xlsx" style="font-size:20px;" aria-hidden="true"></i>', note: 'Import/Export Excel' },
            { name: 'filetype-csv', html: '<i class="bi bi-filetype-csv" style="font-size:20px;" aria-hidden="true"></i>', note: 'Export CSV' },
            { name: 'filetype-pdf', html: '<i class="bi bi-filetype-pdf" style="font-size:20px;" aria-hidden="true"></i>', note: 'Export PDF' },
            { name: 'filetype-ppt', html: '<i class="bi bi-filetype-ppt" style="font-size:20px;" aria-hidden="true"></i>', note: 'Export PowerPoint report' },
            { name: 'bar-chart-steps', html: '<i class="bi bi-bar-chart-steps" style="font-size:20px;" aria-hidden="true"></i>', note: 'Import/Export MS Project' },
            { name: 'code-slash', html: '<i class="bi bi-code-slash" style="font-size:20px;" aria-hidden="true"></i>', note: 'Open source in editor' },
            { name: 'graph-up-arrow', html: '<i class="bi bi-graph-up-arrow" style="font-size:20px;" aria-hidden="true"></i>', note: 'Auto / Trend Report' },
            { name: 'upload', html: '<i class="bi bi-upload" style="font-size:20px;" aria-hidden="true"></i>', note: 'Upload' },
            { name: 'download', html: '<i class="bi bi-download" style="font-size:20px;" aria-hidden="true"></i>', note: 'Download' },
            { name: 'search', html: '<i class="bi bi-search" style="font-size:20px;" aria-hidden="true"></i>', note: 'Search input' },
            { name: 'sun-fill', html: '<i class="bi bi-sun-fill" style="font-size:20px;" aria-hidden="true"></i>', note: 'Theme: Light' },
            { name: 'moon-fill', html: '<i class="bi bi-moon-fill" style="font-size:20px;" aria-hidden="true"></i>', note: 'Theme: Dark' },
            { name: 'display', html: '<i class="bi bi-display" style="font-size:20px;" aria-hidden="true"></i>', note: 'Theme: System' },
            { name: 'clock-history', html: '<i class="bi bi-clock-history" style="font-size:20px;" aria-hidden="true"></i>', note: 'Version History / Baselines' },
            { name: 'people', html: '<i class="bi bi-people" style="font-size:20px;" aria-hidden="true"></i>', note: 'Planning session' },
            { name: 'stop-circle', html: '<i class="bi bi-stop-circle" style="font-size:20px;" aria-hidden="true"></i>', note: 'End session' },
            { name: 'eye', html: '<i class="bi bi-eye" style="font-size:20px;" aria-hidden="true"></i>', note: 'Reveal / View' },
            { name: 'eye-slash', html: '<i class="bi bi-eye-slash" style="font-size:20px;" aria-hidden="true"></i>', note: 'Hide API key' },
            { name: 'plug', html: '<i class="bi bi-plug" style="font-size:20px;" aria-hidden="true"></i>', note: 'Test connection' },
            { name: 'send', html: '<i class="bi bi-send" style="font-size:20px;" aria-hidden="true"></i>', note: 'Send chat message' },
            { name: 'lightning-charge', html: '<i class="bi bi-lightning-charge" style="font-size:20px;" aria-hidden="true"></i>', note: 'Generate report' },
            { name: 'plus-circle', html: '<i class="bi bi-plus-circle" style="font-size:20px;" aria-hidden="true"></i>', note: 'Add to Highlights / Create baseline' },
            { name: 'chat-dots', html: '<i class="bi bi-chat-dots" style="font-size:20px;" aria-hidden="true"></i>', note: 'AI chat launcher' },
            { name: 'arrows-fullscreen', html: '<i class="bi bi-arrows-fullscreen" style="font-size:20px;" aria-hidden="true"></i>', note: 'Expand chat' },
            { name: 'x-lg', html: '<i class="bi bi-x-lg" style="font-size:20px;" aria-hidden="true"></i>', note: 'Close' },
            { name: 'bell', html: '<i class="bi bi-bell" style="font-size:20px;" aria-hidden="true"></i>', note: 'Notifications' },
            { name: 'clipboard-data', html: '<i class="bi bi-clipboard-data" style="font-size:20px;" aria-hidden="true"></i>', note: 'Status bar' },
            { name: 'file-earmark-spreadsheet', html: '<i class="bi bi-file-earmark-spreadsheet" style="font-size:20px;" aria-hidden="true"></i>', note: 'Sync: RAID Log target' },
            { name: 'diagram-3', html: '<i class="bi bi-diagram-3" style="font-size:20px;" aria-hidden="true"></i>', note: 'Sync: MS Project target' },
            { name: 'x-circle', html: '<i class="bi bi-x-circle" style="font-size:20px;" aria-hidden="true"></i>', note: 'Exit read-only banner' },
            { name: 'arrow-counterclockwise', html: '<i class="bi bi-arrow-counterclockwise" style="font-size:20px;" aria-hidden="true"></i>', note: 'Restore version' },
            { name: 'trash', html: '<i class="bi bi-trash" style="font-size:20px;" aria-hidden="true"></i>', note: 'Delete version' },
        ],
    },
    {
        id: 'icons-glyph',
        title: 'Icons — glyph reference (legacy)',
        note:
            'Bare Unicode glyphs and HTML entities used as icons before the sprite existed -- ' +
            'close ×, edit ✎ and delete 🗑 alone account for 60+ instances across the app. ' +
            'Reference only: do not add a new icon here. A new icon-only or icon+label button ' +
            'should use the sprite (above) via &lt;np-button&gt;\'s slot="icon", and an existing ' +
            'glyph usage is a migration candidate the next time its screen is touched, not a ' +
            'pattern to copy forward.',
        variants: [
            { name: 'Close / dismiss — np-close-button\'s own default icon, but still hand-rolled at ~12 one-off sites (.fm-tag-remove, .plan-wizard-close, …)', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">×</span>' },
            { name: 'Remove (alt close glyph)', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">✕</span>' },
            { name: 'Add', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">+</span>' },
            { name: 'Complete / checkmark', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">✓</span>' },
            { name: 'Skipped (wizard step)', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">–</span>' },
            { name: 'Edit (table row actions)', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">✎</span>' },
            { name: 'Delete (table row actions, form footers)', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">🗑</span>' },
            { name: 'Inspect', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">🔍</span>' },
            { name: 'Product', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">📦</span>' },
            { name: 'Task details', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">📋</span>' },
            { name: 'Upload / folder', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">📁</span>' },
            { name: 'Save / download', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">💾</span>' },
            { name: 'Export to Excel', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">📄</span>' },
            { name: 'Import from Excel', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">📤</span>' },
            { name: 'Overflow menu (kebab)', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">⋮</span>' },
            { name: 'Tool-call indicator (AI chat)', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">🔧</span>' },
            { name: 'Sort ascending / find previous', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">▲</span>' },
            { name: 'Sort descending / find next', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">▼</span>' },
            { name: 'Disclosure, collapsed', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">▶</span>' },
            { name: 'Disclosure, expanded', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">▾</span>' },
            { name: 'Undo', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">↩</span>' },
            { name: 'Redo', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">↪</span>' },
            { name: 'Back', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">←</span>' },
            { name: 'Forward', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">→</span>' },
            { name: 'Calendar: previous month', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">‹</span>' },
            { name: 'Calendar: next month', html: '<span style="font-size:20px;line-height:1;" aria-hidden="true">›</span>' },
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
