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
 * Known gap, honestly scoped rather than faked: the Scheduling stage
 * hosts the Tasks view, which already colour-codes tasks by schedule
 * health (RAG) and flags hierarchy/dependency conflicts server-side --
 * but there is no deadline field yet (#877, not started), so this stage
 * cannot "run the scheduler against entered deadlines" as the issue's
 * acceptance criteria describe. It surfaces what the app can show today
 * and says so in its own stage copy, rather than pretending to compute
 * something #877 hasn't built yet. Likewise the Design stage's Backstage
 * host only creates a blank plan today -- template instantiation is
 * itself an open follow-up (#945/#946), not something to duplicate here.
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
            description: 'Tasks are colour-coded by schedule health; deadline-based conflict checks are coming separately.',
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
        if (typeof HighlightToggles !== 'undefined' && HighlightToggles.applyPreset) HighlightToggles.applyPreset(stage.preset);
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
                <button type="button" class="plan-wizard-close" aria-label="Close guided plan">×</button>
            </div>
            <div class="plan-wizard-steps" id="planWizardStepsRow"></div>
            <div class="plan-wizard-description" id="planWizardDescription"></div>
            <div class="plan-wizard-footer">
                <button type="button" class="plan-wizard-back-btn">Back</button>
                <button type="button" class="plan-wizard-skip-btn">Skip</button>
                <button type="button" class="plan-wizard-next-btn">Next</button>
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

        const backBtn = panelEl.querySelector('.plan-wizard-back-btn');
        backBtn.disabled = state.currentIndex === 0;

        const nextBtn = panelEl.querySelector('.plan-wizard-next-btn');
        nextBtn.textContent = isLastStage(state.currentIndex) ? 'Finish' : 'Next';
    }

    const api = {
        STAGES, defaultState, clampIndex, isLastStage, markVisited, markSkipped, normaliseState,
        loadState, open, close, isOpen, next, back, skip, jumpTo, applyStageHost,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.PlanWizard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
