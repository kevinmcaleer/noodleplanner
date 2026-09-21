/**
 * plan-wizard.js — DADESRC stage wizard shell (#1054).
 *
 * A guided flow through Design -> Add tasks -> Dependencies -> Estimating
 * -> Scheduling -> Risks -> Comms. Per the issue's own framing, the shell
 * *hosts* each stage rather than reimplementing it: entering a stage just
 * switches the app to the existing view that already covers it
 * (switchToView()) and applies that stage's highlighting preset
 * (HighlightToggles.applyPreset(), #1051). Nothing here duplicates
 * Notepad/Whiteboard/RAID/Comms/Tasks logic.
 *
 * The Dependencies stage used to also force the whiteboard into a
 * whole-card "dependency link" mode (#1052's wbSetLinkMode()); #1106
 * removed that mode (it let a summary task's card appear to have a
 * dependency, breaking the "summary tasks can't have dependencies" rule)
 * in favour of a per-row drag handle on checklist rows, so this stage now
 * just hosts the Whiteboard view as-is -- there is no board-wide mode
 * left to switch into.
 *
 * Decision (recorded on #1054): a stage is an overlay above the current
 * view, not a modal replacing it. The shell is a small persistent panel
 * (a floating card, not a full-screen dialog like the Excel import
 * wizard at script.js:10135) so the user keeps interacting with the real
 * view underneath -- typing in the Notepad, dragging on the Whiteboard --
 * while the panel's step chips and Back/Skip/Next controls stay
 * reachable. A stage can be entered in any order (chips are always
 * clickable) and re-entered later; progress (current stage, visited vs.
 * skipped) persists in localStorage so closing and reopening the wizard
 * resumes where it left off.
 *
 * The Scheduling stage is the one stage whose content this shell owns
 * outright ("run the scheduler against the entered deadlines and show
 * what breaks"). When the shell first landed it could not: there was no
 * deadline field at all (#877), so the stage said so in its own copy
 * rather than faking a check it could not run. #877 has since landed -- a
 * task line carries a `D2026-09-10` marker and the task form writes one --
 * so the stage now renders a real report (schedule-check.js) over the
 * scheduler's own output, listing every missed or passed deadline,
 * dependency conflict and unplaceable task, each row clicking through to
 * the task it names. It still *hosts* the Tasks view underneath, where
 * deadlines are entered and fixed. The Design stage's Backstage host,
 * meanwhile, still only creates a blank plan -- template instantiation is
 * an open follow-up (#945/#946), not something to duplicate here.
 *
 * A stage can therefore carry optional `content`: a function handed the
 * panel's content element, called on entry and on every re-render of the
 * plan underneath (refreshStageContent(), called from script.js's
 * updateGlobalState). Stages without one -- every stage but Scheduling
 * today -- render nothing extra and keep the panel at its old size.
 *
 * The Design stage's host (Backstage) is the one exception to "entering a
 * stage switches the app to the view that covers it" (#1107): Backstage is
 * a full-screen shell, not a workspace tab the wizard's floating panel can
 * sit over, so applyStageHost() deliberately skips the switchToView() call
 * for it -- see that function's own comment. Opening or stepping onto the
 * Guided Plan wizard's Design stage now only shows the wizard panel and
 * highlights the Design step; it never yanks the user into Backstage as a
 * side effect.
 */
(function (root) {
    const STORAGE_KEY = 'noodleplanner:wizard-state';

    const STAGES = [
        {
            key: 'design', label: 'Design', view: 'backstage', preset: 'design',
            description: 'Start from a blank plan (template picker is coming separately).',
        },
        {
            key: 'add-tasks', label: 'Add Tasks', view: 'notepad', preset: 'add-tasks',
            description: 'Type a line, press Enter, get a task. No Markdown needed.',
        },
        {
            key: 'dependencies', label: 'Dependencies', view: 'whiteboard', preset: 'dependencies',
            description: 'Drag between tasks to link what depends on what.',
        },
        {
            key: 'estimating', label: 'Estimating', view: 'tasks', preset: 'estimating',
            description: 'Use a task’s “Estimate…” menu item for a three-point or t-shirt estimate.',
        },
        {
            key: 'scheduling', label: 'Scheduling', view: 'tasks', preset: 'scheduling',
            description: 'Set a deadline on a task in the Tasks view; anything that breaks shows up here.',
            content: renderSchedulingReport,
        },
        {
            key: 'risks', label: 'Risks', view: 'raid', preset: 'risks',
            description: 'Capture risks against tasks in the RAID log.',
        },
        {
            key: 'comms', label: 'Comms', view: 'comms', preset: 'comms',
            description: 'Build your communications plan from the plan’s milestones.',
        },
    ];

    // ---- Stage content (Scheduling only, today) ----

    /**
     * The Scheduling stage's "what breaks" report. Reads the scheduler's
     * own last output (lastRenderedTasks, set by script.js's
     * updateGlobalState from /api/parse) rather than scheduling anything
     * itself, and hands a clicked row to the Task Inspector so the user
     * lands on the task that broke. Degrades to nothing if either
     * collaborator is absent -- the shell must still work in a page that
     * has not loaded schedule-check.js.
     */
    function renderSchedulingReport(container) {
        if (!container) return;
        if (typeof ScheduleCheck === 'undefined') { container.innerHTML = ''; return; }
        const tasks = (typeof lastRenderedTasks !== 'undefined' && lastRenderedTasks) ? lastRenderedTasks : [];
        ScheduleCheck.render(container, ScheduleCheck.analyse(tasks), {
            onSelect: taskName => {
                if (typeof openTaskInspectorByName === 'function') openTaskInspectorByName(taskName);
            },
            // Re-checking means re-running the plan through the scheduler,
            // which is what the app's own render path already does -- there
            // is nothing to recompute locally.
            onRecheck: () => {
                if (typeof renderPlan === 'function') renderPlan();
                else refreshStageContent();
            },
        });
    }

    // ---- Pure state transitions (no DOM, no globals) ----

    function defaultState() {
        const status = {};
        STAGES.forEach(stage => { status[stage.key] = 'pending'; });
        return { currentIndex: 0, status };
    }

    function clampIndex(index) {
        return Math.min(Math.max(0, index), STAGES.length - 1);
    }

    function isLastStage(index) {
        return index >= STAGES.length - 1;
    }

    /** Entering a stage marks it visited, unless it was already skipped. */
    function markVisited(status, key) {
        if (status[key] === 'skipped') return status;
        return { ...status, [key]: 'visited' };
    }

    function markSkipped(status, key) {
        return { ...status, [key]: 'skipped' };
    }

    function normaliseState(raw) {
        if (!raw || typeof raw.currentIndex !== 'number' || !raw.status) return defaultState();
        const status = {};
        STAGES.forEach(stage => { status[stage.key] = raw.status[stage.key] || 'pending'; });
        return { currentIndex: clampIndex(raw.currentIndex), status };
    }

    // ---- Storage ----

    function loadState() {
        try {
            const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(STORAGE_KEY) : null;
            return raw ? normaliseState(JSON.parse(raw)) : defaultState();
        } catch (error) {
            return defaultState();
        }
    }

    function persistState(state) {
        try {
            if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (error) {
            // Private mode / quota exceeded -- state just won't persist.
        }
    }

    // ---- Live shell state + DOM ----

    let state = null;
    let panelEl = null;

    function currentStage() { return STAGES[state.currentIndex]; }

    function applyStageHost(stage) {
        // #1107: the Design stage hosts Backstage (create a blank plan) --
        // but Backstage is not a normal workspace tab like every other
        // stage's host. It is a distinct full-screen shell (backstage.css
        // hides #ribbonShell/.status-bar under `body.backstage-fullscreen`)
        // that replaces the whole editor rather than sitting behind the
        // wizard's floating panel the way Notepad/Whiteboard/Tasks/RAID/
        // Comms do -- so auto-switching into it doesn't fit this file's own
        // "a stage is an overlay above the current view" model (see the
        // header comment above). Concretely: clicking "Guided Plan" used to
        // yank a user straight out of whatever they were doing and into
        // Backstage the instant the wizard opened (a fresh wizard always
        // starts on the Design stage), which read as "the button opens
        // Backstage" rather than "the button opens the wizard". Backstage
        // stays reachable -- Home/File still open it directly, and a user
        // can always start a blank plan from there themselves -- it just
        // never happens as a side effect of merely opening or stepping
        // through the wizard.
        if (stage.view !== 'backstage' && typeof switchToView === 'function') switchToView(stage.view);
        // #1278: a stage preset is a lens the wizard holds open, not a
        // change to the user's own highlighting preference. applyPreset()
        // persists; applyOverride() does not, so closing the wizard puts
        // the editor's colours back exactly as the user left them. Before
        // this, merely opening the wizard (it starts on Design, whose
        // preset is everything-off) silently turned the editor's
        // resource/date/dependency highlighting off for good.
        if (typeof HighlightToggles !== 'undefined' && HighlightToggles.applyOverride) {
            HighlightToggles.applyOverride(stage.preset);
        }
    }

    function enterStage(index) {
        state.currentIndex = clampIndex(index);
        state.status = markVisited(state.status, currentStage().key);
        persistState(state);
        applyStageHost(currentStage());
        render();
    }

    function next() {
        state.status = markVisited(state.status, currentStage().key);
        if (isLastStage(state.currentIndex)) { close(); return; }
        enterStage(state.currentIndex + 1);
    }

    function back() {
        enterStage(state.currentIndex - 1);
    }

    function skip() {
        state.status = markSkipped(state.status, currentStage().key);
        persistState(state);
        if (isLastStage(state.currentIndex)) { close(); return; }
        enterStage(state.currentIndex + 1);
    }

    function jumpTo(index) { enterStage(index); }

    function isOpen() { return !!panelEl; }

    function open() {
        state = loadState();
        buildPanel();
        applyStageHost(currentStage());
        render();
    }

    function close() {
        if (panelEl) { panelEl.remove(); panelEl = null; }
        if (typeof HighlightToggles !== 'undefined' && HighlightToggles.clearOverride) {
            HighlightToggles.clearOverride();
        }
    }

    // ---- Rendering ----

    function el(tag, className, attrs) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (attrs) for (const key of Object.keys(attrs)) node.setAttribute(key, attrs[key]);
        return node;
    }

    function escapeWizardHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function buildPanel() {
        const existing = document.getElementById('planWizardPanel');
        if (existing) existing.remove();

        // Class names are prefixed plan-wizard- throughout, not the
        // generic wizard- the Excel import wizard already uses
        // (.wizard-step, .wizard-steps, .wizard-panel etc. -- components.css)
        // -- reusing those would collide with its existing markup/CSS.
        panelEl = el('div', 'plan-wizard-panel', { id: 'planWizardPanel', role: 'region', 'aria-label': 'Guided plan wizard' });
        panelEl.innerHTML = `
            <div class="plan-wizard-header">
                <span>Guided Plan</span>
                <np-close-button class="plan-wizard-close" label="Close guided plan"></np-close-button>
            </div>
            <div class="plan-wizard-steps" id="planWizardStepsRow"></div>
            <div class="plan-wizard-description" id="planWizardDescription"></div>
            <div class="plan-wizard-content" id="planWizardStageContent"></div>
            <div class="plan-wizard-footer">
                <np-button variant="neutral" size="small" class="plan-wizard-back-btn">Back</np-button>
                <np-button variant="neutral" size="small" class="plan-wizard-skip-btn">Skip</np-button>
                <np-button variant="primary" size="small" class="plan-wizard-next-btn">Next</np-button>
            </div>
        `;
        document.body.appendChild(panelEl);

        panelEl.querySelector('.plan-wizard-close').addEventListener('click', close);
        panelEl.querySelector('.plan-wizard-back-btn').addEventListener('click', back);
        panelEl.querySelector('.plan-wizard-skip-btn').addEventListener('click', skip);
        panelEl.querySelector('.plan-wizard-next-btn').addEventListener('click', next);
    }

    function stepIcon(status, isCurrent, index) {
        if (isCurrent) return String(index + 1);
        if (status === 'visited') return '✓';
        if (status === 'skipped') return '–';
        return String(index + 1);
    }

    function render() {
        if (!panelEl) return;

        const stepsRow = panelEl.querySelector('#planWizardStepsRow');
        stepsRow.innerHTML = STAGES.map((stage, index) => {
            const isCurrent = index === state.currentIndex;
            const status = state.status[stage.key];
            const classes = ['plan-wizard-step'];
            if (isCurrent) classes.push('current');
            if (status === 'visited') classes.push('visited');
            if (status === 'skipped') classes.push('skipped');
            return `
                <button type="button" class="${classes.join(' ')}" data-stage-index="${index}"
                        aria-label="${escapeWizardHtml(stage.label)}" aria-current="${isCurrent ? 'step' : 'false'}">
                    <span class="plan-wizard-step-bubble">${stepIcon(status, isCurrent, index)}</span>
                    <span class="plan-wizard-step-label">${escapeWizardHtml(stage.label)}</span>
                </button>
            `;
        }).join('');
        stepsRow.querySelectorAll('.plan-wizard-step').forEach(btn => {
            btn.addEventListener('click', () => jumpTo(Number(btn.dataset.stageIndex)));
        });

        panelEl.querySelector('#planWizardDescription').textContent = currentStage().description;
        renderStageContent();

        const backBtn = panelEl.querySelector('.plan-wizard-back-btn');
        backBtn.disabled = state.currentIndex === 0;

        const nextBtn = panelEl.querySelector('.plan-wizard-next-btn');
        nextBtn.textContent = isLastStage(state.currentIndex) ? 'Finish' : 'Next';
    }

    /** Draw the current stage's own content, if it has any. */
    function renderStageContent() {
        if (!panelEl) return;
        const container = panelEl.querySelector('#planWizardStageContent');
        if (!container) return;
        const stage = currentStage();
        if (typeof stage.content === 'function') stage.content(container);
        else container.innerHTML = '';
    }

    /**
     * Re-draw the current stage's content against the plan as it now
     * stands. Called from script.js's updateGlobalState() after every
     * parse, so the Scheduling stage's report tracks the plan the user is
     * editing underneath the panel instead of going stale. A no-op when
     * the wizard is closed or the stage has no content of its own.
     */
    function refreshStageContent() {
        if (!panelEl) return;
        renderStageContent();
    }

    const api = {
        STAGES, defaultState, clampIndex, isLastStage, markVisited, markSkipped, normaliseState,
        loadState, open, close, isOpen, next, back, skip, jumpTo, applyStageHost, refreshStageContent,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.PlanWizard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
