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
