/**
 * <np-task-row> -- one task, one row, everywhere a list of tasks is shown.
 *
 * ## Why this exists
 *
 * A survey of the app found about twenty-five places that list tasks one per
 * row, and no two of them agreed. Inside the task form alone:
 *
 *   - Subtasks were bordered cards with a 16px conic "mini pie chart", a
 *     start-finish range and hand-built 24px initials circles.
 *   - Dependencies were a <table> of bare inputs (name, a native <select>,
 *     lag) with a solid red "x" -- no status, no way to reach the task.
 *   - The product form's activities were a flex list showing "NN%" as text.
 *
 * Completion was drawn five ways (pie, <np-checkbox>, a native checkbox,
 * "NN%" text, nothing), RAG five ways across three hex palettes, and
 * assignees three ways. This is the row the Penpot "Task row" component
 * (02 . Components -> "Task row") specifies, built from the parts the app
 * already standardised: <np-checkbox> for completion,
 * <np-resource-stack> for people and <np-rag> for status.
 *
 * ## Anatomy
 *
 * Every type uses the same slots, left to right, and leaves out the ones it
 * does not need:
 *
 *   drag handle . disclosure . completion . ID . name . details . RAG .
 *   people . action
 *
 * `type` picks the set:
 *
 *   list      subtasks, activities: completion, name, dates, RAG, people.
 *   relation  a dependency: ID, name, a type + lag pill ("FS +2d"), date.
 *             `driving` marks the predecessor that sets the start: the
 *             pill takes the accent and reads "Driving · FS +2d".
 *             Clicking the pill (or setting `editing`) turns it into a type
 *             select and a lag input. Completion is shown, not taken.
 *   picker    an autocomplete option: ID and dates tell similar names
 *             apart; `selected` is the keyboard-active option. Completion
 *             and people are shown, not taken -- a click anywhere on the
 *             row is the host's to treat as picking it (the task form's
 *             add-dependency box does).
 *
 * `readonly` makes any row display-only: the checkbox and the pill stop
 * taking input.
 *   outline   writing a plan: name and an estimate, no people or RAG.
 *
 * A summary can carry a `count` ("3", "2/5") in a small pill, and any row
 * an `action` of menu, remove or open (`action-label` renames it for
 * assistive technology and the tooltip). Menu and remove are revealed on
 * hover; open is always shown, because it is the way in.
 *
 * `density="compact"` is the 32px row for dropdowns and dense panels; the
 * default is 40px. Under a coarse pointer every row is at least
 * --np-touch-target tall.
 *
 * ## Things the host decides
 *
 * The row renders what it is given and reports what the user did. It never
 * reads the plan or script.js: dates arrive preformatted in `meta`, people
 * as full names in `resources`, and every gesture leaves as an event. That
 * keeps it usable in Storybook and in any view.
 *
 * Indentation is `depth` x --np-space-16, never spaces in the name.
 *
 * The drag handle and the trailing action are revealed with opacity, not
 * display, so nothing moves when the pointer arrives. On a coarse pointer
 * they are always shown, because there is no hover to reveal them.
 *
 * ## Usage
 *
 *   <script type="module" src="/static/components/task-row/np-task-row.js"></script>
 *   <np-task-row name="Draft brief" meta="3 Sep – 9 Sep" percent="40"
 *                rag="green" resources="Sam Smith" assignable></np-task-row>
 *   <np-task-row type="relation" task-id="14" name="Sign off design"
 *                relation="FS" lag="+2d" meta="3 Sep" action="remove"></np-task-row>
 *
 * ## Events (all bubble and cross the shadow boundary)
 *
 *   task-open        the name was activated          { name, taskId }
 *   task-toggle      the checkbox was ticked/unticked { name, checked }
 *   task-action      the trailing action was clicked { name, kind }
 *   task-assign      the people slot was clicked     { name, anchor, resource }
 *                    (only with `assignable`)
 *   name-commit      editing: Enter or blur           { value }
 *   name-cancel      editing: Escape
 *   relation-change  type or lag changed             { name, relation, lag }
 *   collapse-toggle  the disclosure was clicked      { name, collapsed }
 */

import '../checkbox/np-checkbox.js';
import '../resource-stack/np-resource-stack.js';
import '../rag/np-rag.js';

export { ragColour } from '../rag/rag.js';

const TYPES = ['list', 'relation', 'picker', 'outline'];
const RELATIONS = ['FS', 'SS', 'FF', 'SF'];
const ACTION_GLYPHS = { menu: '⋯', remove: '✕', open: '›' };
const ACTION_LABELS = { menu: 'More actions', remove: 'Remove', open: 'Open' };

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      display: block;
      color: var(--np-ink);
      font-family: var(--np-font-ui);
    }
    :host([hidden]) { display: none; }

    .row {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: var(--np-space-8);
      min-height: var(--np-space-40);
      padding: 0 var(--np-space-8);
      padding-left: calc(var(--np-space-8) + var(--np-task-row-depth, 0) * var(--np-space-16));
      border-radius: var(--np-radius-md);
      font-size: var(--np-text-90);
      line-height: var(--np-leading-tight);
      transition: background-color 0.12s ease;
    }
    :host([density="compact"]) .row {
      min-height: var(--np-space-32);
      font-size: var(--np-text-85);
    }
    .row:hover { background: var(--np-bg-hover); }
    :host([selected]) .row { background: var(--np-selected); }
    :host([type="picker"]) .row { cursor: pointer; }
    :host([editing]) .row { background: var(--np-surface); }

    [hidden] { display: none !important; }

    /* Revealed by opacity, not display, so the row never reflows on hover. */
    .handle, .action {
      opacity: 0;
      transition: opacity 0.12s ease;
    }
    /* "open" goes somewhere rather than doing something to the row, so it is
       a way in that has to be findable, not a hover affordance. */
    .action[data-kind="open"] { opacity: 1; }
    .row:hover .handle, .row:hover .action,
    .row:focus-within .handle, .row:focus-within .action,
    :host([selected]) .handle, :host([selected]) .action,
    :host([editing]) .handle, :host([editing]) .action {
      opacity: 1;
    }

    .handle {
      flex: 0 0 auto;
      color: var(--np-faint);
      font-size: var(--np-text-75);
      cursor: grab;
      user-select: none;
    }

    /* 24px, not the 16px glyph, so the arrow is a WCAG 2.5.8 target. */
    .disclosure, .spacer {
      flex: 0 0 auto;
      width: var(--np-space-24);
      height: var(--np-space-24);
    }
    .disclosure {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 0;
      border-radius: var(--np-radius-sm);
      background: transparent;
      color: var(--np-faint);
      font: inherit;
      font-size: var(--np-text-75);
      cursor: pointer;
    }
    .disclosure:hover { color: var(--np-ink); }

    np-checkbox { flex: 0 0 auto; }

    .id, .meta {
      flex: 0 0 auto;
      color: var(--np-faint);
      font-family: var(--np-font-data);
      font-size: var(--np-text-75);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .name {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
    }
    /* A 24px line box, so the name is a 24px target without giving up the
       ellipsis a flex button would lose. */
    button.name {
      min-height: var(--np-space-24);
      line-height: var(--np-space-24);
      cursor: pointer;
    }
    button.name:hover { text-decoration: underline; text-underline-offset: 2px; }
    :host([summary]) .name { font-weight: var(--np-weight-semibold); }
    :host([done]) .name {
      color: var(--np-faint);
      text-decoration: line-through;
    }

    input, select {
      box-sizing: border-box;
      height: var(--np-space-32);
      padding: 0 var(--np-space-8);
      border: 1px solid var(--np-border-strong);
      border-radius: var(--np-radius-sm);
      background: var(--np-input-bg);
      color: var(--np-ink);
      font: inherit;
    }
    input:focus, select:focus {
      outline: none;
      border-color: var(--np-accent);
      box-shadow: 0 0 0 1px var(--np-accent);
    }
    :host([density="compact"]) input, :host([density="compact"]) select {
      height: var(--np-space-24);
    }
    .name-input { flex: 1 1 auto; min-width: 0; }
    .rel-type, .rel-lag {
      flex: 0 0 auto;
      width: var(--np-space-64);
      font-family: var(--np-font-data);
      font-size: var(--np-text-75);
    }

    .pill {
      flex: 0 0 auto;
      padding: var(--np-space-2) var(--np-space-8);
      border: 1px solid var(--np-border);
      border-radius: var(--np-radius-pill);
      background: var(--np-surface);
      color: var(--np-body);
      font-family: var(--np-font-data);
      font-size: var(--np-text-75);
      font-weight: var(--np-weight-medium);
      white-space: nowrap;
    }
    button.pill { cursor: pointer; }
    button.pill:hover { border-color: var(--np-border-strong); color: var(--np-ink); }
    :host([readonly]) button.pill { cursor: default; }
    :host([readonly]) button.pill:hover { border-color: var(--np-border); color: var(--np-body); }
    :host([driving]) .pill {
      border-color: var(--np-accent);
      background: var(--np-accent-tint);
      color: var(--np-accent-ink);
    }

    /* A summary's child count ("3", "2/5"): what it holds, before it is
       opened. Read-only; the trailing action is what opens it. */
    .count {
      flex: 0 0 auto;
      min-width: var(--np-space-16);
      padding: 0 var(--np-space-4);
      border: 1px solid var(--np-border);
      border-radius: var(--np-radius-pill);
      background: var(--np-surface);
      color: var(--np-body);
      font-size: var(--np-text-75);
      font-weight: var(--np-weight-semibold);
      font-variant-numeric: tabular-nums;
      line-height: var(--np-leading-snug);
      text-align: center;
      white-space: nowrap;
    }

    .rag { flex: 0 0 auto; }

    .people {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
    }
    /* The quick-assign target: a 24px button drawing the 20px dashed
       circle the people chips are, so it lines up with them. */
    .assign {
      position: relative;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--np-space-24);
      height: var(--np-space-24);
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--np-faint);
      font: inherit;
      font-size: var(--np-text-75);
      line-height: 1;
      cursor: pointer;
    }
    .assign::before {
      content: '';
      position: absolute;
      inset: var(--np-space-2);
      border: 1.5px dashed var(--np-border-control);
      border-radius: var(--np-radius-circle);
    }
    .assign:hover { color: var(--np-ink); }
    .assign:hover::before { border-color: var(--np-ink); }

    .action {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--np-space-24);
      height: var(--np-space-24);
      padding: 0;
      border: 0;
      border-radius: var(--np-radius-sm);
      background: transparent;
      color: var(--np-faint);
      font: inherit;
      font-weight: var(--np-weight-bold);
      cursor: pointer;
    }
    .action:hover { background: var(--np-bg-hover); color: var(--np-ink); }
    .action[data-kind="remove"]:hover { color: var(--np-danger); }
    :host([selected]) .action:hover { background: var(--np-surface); }

    .hint {
      flex: 0 0 auto;
      color: var(--np-faint);
      font-size: var(--np-text-75);
      visibility: hidden;
    }
    :host([selected]) .hint { visibility: visible; }

    button:focus-visible, .disclosure:focus-visible {
      outline: var(--np-focus-ring-width, 2px) solid var(--np-focus-ring-color);
      outline-offset: var(--np-focus-ring-offset, 2px);
    }

    @media (pointer: coarse) {
      .row, :host([density="compact"]) .row { min-height: var(--np-touch-target); }
      .handle, .action { opacity: 1; }
      .action { width: var(--np-touch-target); height: var(--np-touch-target); }
    }
  </style>
  <div class="row" part="row">
    <span class="handle" part="handle" aria-hidden="true">⠿</span>
    <button type="button" class="disclosure" part="disclosure"></button>
    <span class="spacer" aria-hidden="true"></span>
    <np-checkbox part="checkbox"></np-checkbox>
    <span class="id" part="id"></span>
    <button type="button" class="name" part="name"></button>
    <span class="name" part="name"></span>
    <input class="name-input" part="name-input" type="text" autocomplete="off" />
    <button type="button" class="pill" part="relation"></button>
    <select class="rel-type" aria-label="Dependency type">
      ${RELATIONS.map((r) => `<option value="${r}">${r}</option>`).join('')}
    </select>
    <input class="rel-lag" type="text" aria-label="Lag or lead" placeholder="+2d" autocomplete="off" />
    <span class="count" part="count"></span>
    <span class="meta" part="meta"></span>
    <np-rag class="rag" part="rag"></np-rag>
    <span class="people" part="people">
      <np-resource-stack max="3"></np-resource-stack>
      <button type="button" class="assign" aria-label="Assign a resource" title="Assign a resource">+</button>
    </span>
    <button type="button" class="action" part="action"></button>
    <span class="hint" aria-hidden="true">↵</span>
  </div>
`;

export class NpTaskRow extends HTMLElement {
    static get observedAttributes() {
        return [
            'type', 'density', 'name', 'task-id', 'percent', 'summary', 'indeterminate',
            'meta', 'rag', 'rag-label', 'resources', 'assignable', 'relation', 'lag',
            'editing', 'placeholder', 'selected', 'handle', 'action', 'depth',
            'collapsible', 'collapsed', 'readonly', 'driving', 'count', 'action-label',
        ];
    }

    constructor() {
        super();
        const root = this.attachShadow({ mode: 'open' });
        root.appendChild(TEMPLATE.content.cloneNode(true));
        // Upgrade the <np-checkbox> and <np-resource-stack> inside now, while
        // the row is still detached, so the properties set on them below are
        // their real setters rather than plain fields that would shadow them.
        customElements.upgrade(root);
        const $ = (sel) => root.querySelector(sel);
        this._els = {
            handle: $('.handle'),
            disclosure: $('.disclosure'),
            spacer: $('.spacer'),
            checkbox: $('np-checkbox'),
            id: $('.id'),
            nameButton: $('button.name'),
            nameText: $('span.name'),
            nameInput: $('.name-input'),
            pill: $('.pill'),
            relType: $('.rel-type'),
            relLag: $('.rel-lag'),
            count: $('.count'),
            meta: $('.meta'),
            rag: $('.rag'),
            people: $('.people'),
            stack: $('np-resource-stack'),
            assign: $('.assign'),
            action: $('.action'),
            hint: $('.hint'),
        };
        this._wasEditing = false;
        this._committed = false;
        this._wire();
    }

    // ── Public API ─────────────────────────────────────────────────────────

    get type() {
        const t = this.getAttribute('type');
        return TYPES.includes(t) ? t : 'list';
    }

    get name() { return this.getAttribute('name') || ''; }
    set name(value) { this.setAttribute('name', value == null ? '' : String(value)); }

    get percent() {
        const p = parseFloat(this.getAttribute('percent'));
        return Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 0;
    }
    set percent(value) { this.setAttribute('percent', String(value)); }

    get done() { return this.percent >= 100; }

    /** `{ name|shortname: { name, role, email, shortname } }` for the people
     * slot's profile card -- passed straight to <np-resource-stack>. */
    get details() { return this._els.stack.details; }
    set details(value) { this._els.stack.details = value || {}; }

    /** The <np-checkbox> inside, for a host that adds a long-press to it. */
    get checkbox() { return this._els.checkbox; }

    /** The element a host should anchor an assign picker to. */
    get peopleAnchor() { return this._els.people; }

    /** Put the caret in the name (or lag) input when editing. */
    focusEditor() {
        const el = this.type === 'relation' ? this._els.relType : this._els.nameInput;
        if (!el.hidden) el.focus();
    }

    connectedCallback() { this._render(); }
    attributeChangedCallback() { this._render(); }

    // ── Internals ──────────────────────────────────────────────────────────

    _emit(type, detail = {}) {
        this.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail }));
    }

    _wire() {
        const e = this._els;

        e.nameButton.addEventListener('click', (event) => {
            event.stopPropagation();
            this._emit('task-open', { name: this.name, taskId: this.getAttribute('task-id') || '' });
        });

        // <np-checkbox> reports `change`; the row re-reports it with the task
        // it belongs to, so a host never has to walk back out of the shadow
        // root to find which task was ticked.
        e.checkbox.addEventListener('change', (event) => {
            event.stopPropagation();
            this._emit('task-toggle', { name: this.name, checked: Boolean(event.detail?.checked) });
        });
        e.checkbox.addEventListener('click', (event) => event.stopPropagation());

        e.disclosure.addEventListener('click', (event) => {
            event.stopPropagation();
            const collapsed = !this.hasAttribute('collapsed');
            this.toggleAttribute('collapsed', collapsed);
            this._emit('collapse-toggle', { name: this.name, collapsed });
        });

        e.action.addEventListener('click', (event) => {
            event.stopPropagation();
            this._emit('task-action', { name: this.name, kind: this.getAttribute('action') });
        });

        const assign = (resource) => {
            this._emit('task-assign', { name: this.name, anchor: e.people, resource });
        };
        e.assign.addEventListener('click', (event) => {
            event.stopPropagation();
            assign(null);
        });
        // A chip click is np-resource-stack's `resource-activate`. When the
        // row is assignable that means "change who is on this", so it
        // becomes the row's own event rather than leaking the stack's.
        e.stack.addEventListener('resource-activate', (event) => {
            if (!this.hasAttribute('assignable')) return;
            event.stopPropagation();
            assign(event.detail || null);
        });

        // Name editing: Enter or leaving the field commits, Escape abandons.
        e.nameInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this._commitName();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                this._committed = true;
                this._emit('name-cancel', { name: this.name });
            }
        });
        e.nameInput.addEventListener('blur', () => this._commitName());

        // Relation: clicking the pill edits it; changes report as they happen
        // so the plan text follows the form the way the old table did.
        e.pill.addEventListener('click', (event) => {
            event.stopPropagation();
            if (this.hasAttribute('readonly')) return;
            this.setAttribute('editing', '');
            this.focusEditor();
        });
        const relationChanged = () => {
            const relation = e.relType.value;
            const lag = e.relLag.value.trim();
            this.setAttribute('relation', relation);
            if (lag) this.setAttribute('lag', lag); else this.removeAttribute('lag');
            this._emit('relation-change', { name: this.name, relation, lag });
        };
        e.relType.addEventListener('change', relationChanged);
        e.relLag.addEventListener('change', relationChanged);
        const leaveOnKey = (event) => {
            if (event.key === 'Enter' || event.key === 'Escape') {
                event.preventDefault();
                if (event.key === 'Enter' && event.target === e.relLag) relationChanged();
                this.removeAttribute('editing');
            }
        };
        e.relType.addEventListener('keydown', leaveOnKey);
        e.relLag.addEventListener('keydown', leaveOnKey);
        // Leaving the row ends editing. Checked once focus has settled, not
        // from the event: swapping the pill for the select hides the focused
        // pill, and that blur arrives with no relatedTarget even though focus
        // is on its way to the select inside this same row.
        this.addEventListener('focusout', () => {
            if (this.type !== 'relation' || !this.hasAttribute('editing')) return;
            setTimeout(() => {
                if (this.shadowRoot.activeElement) return;
                this.removeAttribute('editing');
            }, 0);
        });
    }

    _commitName() {
        if (this._committed || !this.hasAttribute('editing') || this.type === 'relation') return;
        this._committed = true;
        this._emit('name-commit', { value: this._els.nameInput.value.trim() });
    }

    _render() {
        const e = this._els;
        if (!e) return;
        const type = this.type;
        const name = this.name;
        const editing = this.hasAttribute('editing');
        const summary = this.hasAttribute('summary');
        const tree = type === 'list' || type === 'outline';

        const depth = parseInt(this.getAttribute('depth'), 10);
        if (Number.isFinite(depth) && depth > 0) this.style.setProperty('--np-task-row-depth', String(depth));
        else this.style.removeProperty('--np-task-row-depth');

        // Picker rows are options in a listbox; the host is what the list's
        // aria-activedescendant points at.
        if (type === 'picker') {
            if (!this.hasAttribute('role')) this.setAttribute('role', 'option');
            this.setAttribute('aria-selected', this.hasAttribute('selected') ? 'true' : 'false');
        }

        // Drag handle and disclosure.
        e.handle.hidden = !this.hasAttribute('handle');
        const collapsible = tree && summary && this.hasAttribute('collapsible');
        e.disclosure.hidden = !collapsible;
        // `collapsible` on a leaf reserves the same 16px, so leaves line up
        // under their summaries' arrows.
        e.spacer.hidden = collapsible || !tree || !this.hasAttribute('collapsible');
        if (collapsible) {
            const collapsed = this.hasAttribute('collapsed');
            e.disclosure.textContent = collapsed ? '▸' : '▾';
            e.disclosure.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            e.disclosure.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} "${name}"`);
        }

        // Completion.
        const pct = this.percent;
        const done = pct >= 100;
        this.toggleAttribute('done', done);
        const cb = e.checkbox;
        cb.toggleAttribute('dense', this.getAttribute('density') === 'compact');
        cb.setAttribute('row', summary ? 'summary' : 'leaf');
        cb.toggleAttribute('checked', done);
        cb.toggleAttribute('indeterminate', summary && !done && this.hasAttribute('indeterminate'));
        if (!summary && pct > 0 && pct < 100) cb.setAttribute('progress', String(pct));
        else cb.removeAttribute('progress');
        const pctText = !done && pct > 0 ? ` (${Math.round(pct)}% complete)` : '';
        cb.setAttribute('label', `Mark "${name}" as ${done ? 'incomplete' : 'complete'}${pctText}`);
        cb.title = done ? 'Mark as incomplete' : pctText ? `${Math.round(pct)}% complete -- click to mark as complete` : 'Mark as complete';
        // Completion is shown everywhere but only taken on a list or outline
        // row. A relation row describes another task and a picker row is an
        // option, so ticking either would change something the user is not
        // looking at. `inert` rather than `disabled`, which would fade it.
        cb.inert = this.hasAttribute('readonly') || type === 'relation' || type === 'picker';

        // ID.
        const taskId = this.getAttribute('task-id') || '';
        e.id.textContent = taskId;
        e.id.hidden = !taskId || !(type === 'relation' || type === 'picker');

        // Name: a button that opens the task, plain text in a picker, an
        // input while editing a list or outline row.
        const editsName = editing && type !== 'relation';
        e.nameButton.textContent = name;
        e.nameButton.title = name;
        e.nameText.textContent = name;
        e.nameText.title = name;
        e.nameButton.hidden = editsName || type === 'picker';
        e.nameText.hidden = editsName || type !== 'picker';
        e.nameInput.hidden = !editsName;
        e.nameInput.placeholder = this.getAttribute('placeholder') || 'Task name';
        if (editsName && !this._wasEditing) {
            e.nameInput.value = name;
            this._committed = false;
        }

        // Relation pill, or its editors.
        const relation = (this.getAttribute('relation') || 'FS').toUpperCase();
        const lag = this.getAttribute('lag') || '';
        const isRelation = type === 'relation';
        e.pill.hidden = !isRelation || editing;
        // The driving predecessor says so in words, not only in the accent
        // fill, so the cue survives any theme and a screen reader.
        const driving = this.hasAttribute('driving');
        const relText = lag ? `${relation} ${lag}` : relation;
        e.pill.textContent = driving ? `Driving · ${relText}` : relText;
        const relLabel = `${driving ? 'Driving dependency' : 'Dependency'} ${relation}${lag ? ` ${lag}` : ''}`;
        e.pill.title = this.hasAttribute('readonly') ? '' : 'Change the dependency type or lag';
        e.pill.setAttribute('aria-label', this.hasAttribute('readonly') ? relLabel : `${relLabel}. Edit`);
        e.relType.hidden = !isRelation || !editing;
        e.relLag.hidden = !isRelation || !editing;
        if (isRelation && editing && !this._wasEditing) {
            e.relType.value = RELATIONS.includes(relation) ? relation : 'FS';
            e.relLag.value = lag;
        }
        this._wasEditing = editing;

        const count = this.getAttribute('count') || '';
        e.count.textContent = count;
        e.count.hidden = !count;

        // Details.
        const meta = this.getAttribute('meta') || '';
        e.meta.textContent = meta;
        e.meta.hidden = !meta;

        // RAG: one <np-rag> dot, blue once the task is done.
        const ragAttr = this.getAttribute('rag') || '';
        e.rag.hidden = !this.hasAttribute('rag') || type === 'outline';
        e.rag.setAttribute('status', ragAttr);
        e.rag.toggleAttribute('done', done);
        e.rag.setAttribute('label', this.getAttribute('rag-label') || ragAttr || 'No status');

        // People.
        const names = String(this.getAttribute('resources') || '')
            .split(',').map((n) => n.trim()).filter(Boolean);
        const showPeople = this.hasAttribute('resources') || this.hasAttribute('assignable');
        e.people.hidden = !showPeople || type === 'outline';
        // A picker row is one option: its chips are part of what it says, not
        // controls of their own, so a click on them picks the row.
        e.people.inert = type === 'picker';
        if (names.join(',') !== e.stack.names.join(',')) e.stack.names = names;
        e.stack.hidden = names.length === 0;
        e.assign.hidden = names.length > 0 || !this.hasAttribute('assignable');

        // Trailing action.
        const kind = this.getAttribute('action');
        const hasAction = Object.prototype.hasOwnProperty.call(ACTION_GLYPHS, kind);
        e.action.hidden = !hasAction;
        if (hasAction) {
            e.action.dataset.kind = kind;
            e.action.textContent = ACTION_GLYPHS[kind];
            const custom = this.getAttribute('action-label');
            e.action.setAttribute('aria-label', custom || `${ACTION_LABELS[kind]} "${name}"`);
            e.action.title = custom || ACTION_LABELS[kind];
        }

        e.hint.hidden = type !== 'picker';
    }
}

if (!customElements.get('np-task-row')) {
    customElements.define('np-task-row', NpTaskRow);
}
