/**
 * Initiatives (epic #1476).
 *
 * An initiative is a lighter-weight plan than a project: a bundle of related
 * tasks with no milestones or gateways. It is marked by `type: initiative` in
 * the plan's front matter and is stored in the same project store as every
 * other plan, so it can sit under a programme (`programme:`) or stand alone.
 *
 * A project's RAG is computed from its schedule; an initiative has none of
 * that rigor, so its RAG is stated by a person (`rag:`, `rag_comment:`,
 * `rag_updated:`). An initiative nobody has rated is "not rated" -- never a
 * computed green.
 *
 * The pure helpers here are unit tested (tests/test_initiative.js); the
 * dialog at the bottom is DOM wiring.
 */

const PLAN_TYPE_PROJECT = 'project';
const PLAN_TYPE_INITIATIVE = 'initiative';
const INITIATIVE_RAG_VALUES = ['green', 'amber', 'red'];

/** Scalar front-matter fields of a plan, keys lowercased. */
function readFrontMatterFields(planText) {
    const fields = {};
    const match = (planText || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return fields;
    match[1].split(/\r?\n/).forEach(line => {
        const kv = line.match(/^([A-Za-z_][^:\s]*(?: [^:\s]+)*):\s*(.*)$/);
        if (kv) fields[kv[1].trim().toLowerCase()] = kv[2].trim();
    });
    return fields;
}

/** `initiative` or `project`; anything missing or unknown is a project. */
function extractPlanType(planText) {
    const value = (readFrontMatterFields(planText).type || '').toLowerCase();
    return value === PLAN_TYPE_INITIATIVE ? PLAN_TYPE_INITIATIVE : PLAN_TYPE_PROJECT;
}

function isInitiativePlan(planText) {
    return extractPlanType(planText) === PLAN_TYPE_INITIATIVE;
}

/** Same check on an already-parsed front-matter object (keys lowercased). */
function isInitiativeFrontMatter(frontMatter) {
    const value = frontMatter && frontMatter.type ? String(frontMatter.type).split('\n')[0].trim().toLowerCase() : '';
    return value === PLAN_TYPE_INITIATIVE;
}

/** Normalise a stated RAG ("Amber", "yellow", "R") to green/amber/red, or null. */
function normaliseInitiativeRag(value) {
    const r = String(value || '').split('\n')[0].trim().toLowerCase();
    if (!r) return null;
    if (r.includes('red') || r === 'r') return 'red';
    if (r.includes('amber') || r.includes('yellow') || r === 'a') return 'amber';
    if (r.includes('green') || r === 'g') return 'green';
    return null;
}

/**
 * The stated RAG of an initiative plan: {rag, comment, updated}. `rag` is
 * null when nobody has rated it.
 */
function getInitiativeRag(planTextOrFrontMatter) {
    const fm = typeof planTextOrFrontMatter === 'string'
        ? readFrontMatterFields(planTextOrFrontMatter)
        : (planTextOrFrontMatter || {});
    const first = key => (fm[key] ? String(fm[key]).split('\n')[0].trim() : '');
    return {
        rag: normaliseInitiativeRag(first('rag') || first('rag status') || first('rag_status')),
        comment: first('rag_comment'),
        updated: first('rag_updated'),
    };
}

function _stripQuotes(text) {
    return String(text || '').replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Write a stated RAG into front matter. A null/unknown `rag` clears all
 * three fields (back to "not rated"). `today` is injectable for tests.
 */
function setInitiativeRag(planText, rag, comment, today) {
    const setField = _frontMatterHelper('setFrontMatterField');
    const removeField = _frontMatterHelper('removeFrontMatterField');
    const value = normaliseInitiativeRag(rag);
    let text = planText || '';
    if (!value) {
        ['rag', 'rag_comment', 'rag_updated'].forEach(key => { text = removeField(text, key); });
        return text;
    }
    text = setField(text, 'rag', value);
    const note = _stripQuotes(comment);
    text = note ? setField(text, 'rag_comment', note) : removeField(text, 'rag_comment');
    text = setField(text, 'rag_updated', today || new Date().toISOString().slice(0, 10));
    return text;
}

function _frontMatterHelper(name) {
    if (typeof window !== 'undefined' && typeof window[name] === 'function') return window[name];
    if (typeof require === 'function') return require('./portfolio-projects-table.js')[name];
    throw new Error(name + ' is not available');
}

/** The starting text for a new initiative: minimal front matter and a task list. */
function buildInitiativeTemplate(name) {
    const title = _stripQuotes(name) || 'Untitled Initiative';
    return [
        '---',
        'title: ' + title,
        'type: initiative',
        '---',
        '',
        'First task 1d',
        'Second task 2d',
        '',
    ].join('\n');
}

/** Label for the status column and the portfolio report. */
function initiativeRagLabel(rag) {
    if (rag === 'green') return 'On Track';
    if (rag === 'amber') return 'At Risk';
    if (rag === 'red') return 'Off Track';
    return 'Not Rated';
}

/**
 * Move an initiative under an existing programme (#1487), or out of its
 * programme when `programme` is falsy. Only existing programmes can be
 * chosen: this never creates one.
 */
function setInitiativeProgramme(planText, programme) {
    const apply = _frontMatterHelper('applyProgrammeFrontMatter');
    return programme && programme.slug
        ? apply(planText, programme.slug, programme.name)
        : apply(planText, null);
}

/**
 * Ribbon labels (ribbon-ia.js) an initiative hides is decided there; the
 * views an initiative offers are the task list and the board.
 */
const INITIATIVE_VIEWS = ['outline', 'tasks', 'board'];

// ---------------------------------------------------------------------------
// DOM wiring
// ---------------------------------------------------------------------------

function currentPlanTextForInitiative() {
    const editor = typeof document !== 'undefined' ? document.getElementById('planEditor') : null;
    return editor ? editor.value : '';
}

/** Mirror the open plan's type onto <html data-plan-type> and the ribbon. */
function applyPlanTypeToDocument(planText) {
    if (typeof document === 'undefined') return;
    const type = extractPlanType(planText);
    document.documentElement.setAttribute('data-plan-type', type);
    if (typeof window.setRibbonPlanType === 'function') window.setRibbonPlanType(type);
}

function openInitiativeRagDialog() {
    const editor = document.getElementById('planEditor');
    if (!editor || !isInitiativePlan(editor.value)) {
        if (typeof showToast === 'function') showToast('Only initiatives have a stated RAG.', 'info');
        return;
    }
    const current = getInitiativeRag(editor.value);
    const dialog = document.createElement('dialog');
    dialog.className = 'initiative-rag-dialog';
    dialog.setAttribute('aria-label', 'Set initiative RAG');
    dialog.innerHTML =
        '<form method="dialog" class="initiative-rag-form">' +
        '<h2>Initiative status</h2>' +
        '<fieldset><legend>RAG</legend>' +
        ['green', 'amber', 'red'].map(v =>
            '<label><input type="radio" name="rag" value="' + v + '"' + (current.rag === v ? ' checked' : '') + '> ' +
            '<np-rag status="' + v + '"></np-rag> ' + initiativeRagLabel(v) + '</label>'
        ).join('') +
        '<label><input type="radio" name="rag" value=""' + (current.rag ? '' : ' checked') + '> Not rated</label>' +
        '</fieldset>' +
        '<label>Comment <input type="text" name="comment" maxlength="200"></label>' +
        '<div class="initiative-rag-actions">' +
        '<np-button type="button" data-action="cancel">Cancel</np-button>' +
        '<np-button type="submit" variant="primary" data-action="save">Save</np-button>' +
        '</div></form>';
    dialog.querySelector('input[name="comment"]').value = current.comment;
    document.body.appendChild(dialog);
    const close = () => { dialog.close(); dialog.remove(); };
    dialog.querySelector('[data-action="cancel"]').addEventListener('click', close);
    dialog.querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        const form = event.target;
        const updated = setInitiativeRag(editor.value, form.rag.value, form.comment.value);
        if (updated !== editor.value) {
            editor.value = updated;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
        close();
    });
    dialog.addEventListener('cancel', () => dialog.remove());
    dialog.showModal();
}

function openInitiativeProgrammeDialog() {
    const editor = document.getElementById('planEditor');
    if (!editor || !isInitiativePlan(editor.value)) {
        if (typeof showToast === 'function') showToast('Only initiatives can be moved under a programme.', 'info');
        return;
    }
    const all = typeof loadAllProjectsIntoCache === 'function' ? loadAllProjectsIntoCache() : listProjects();
    const programmes = deriveProgrammes(all);
    if (programmes.length === 0) {
        if (typeof showToast === 'function') showToast('No programmes yet. Group projects into a programme from the Portfolio first.', 'info');
        return;
    }
    const current = (typeof extractProjectProgramme === 'function' ? extractProjectProgramme(editor.value) : null) || { slug: '' };
    const dialog = document.createElement('dialog');
    dialog.className = 'initiative-programme-dialog';
    dialog.setAttribute('aria-label', 'Move initiative under a programme');
    const esc = typeof escapeHtml === 'function' ? escapeHtml : s => String(s);
    dialog.innerHTML =
        '<form method="dialog" class="initiative-programme-form">' +
        '<h2>Programme</h2>' +
        '<label>Move under <select name="programme">' +
        '<option value="">No programme</option>' +
        programmes.map(p => '<option value="' + esc(p.slug) + '"' + (p.slug === current.slug ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') +
        '</select></label>' +
        '<div class="initiative-rag-actions">' +
        '<np-button type="button" data-action="cancel">Cancel</np-button>' +
        '<np-button type="submit" variant="primary" data-action="save">Save</np-button>' +
        '</div></form>';
    document.body.appendChild(dialog);
    const close = () => { dialog.close(); dialog.remove(); };
    dialog.querySelector('[data-action="cancel"]').addEventListener('click', close);
    dialog.querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        const chosen = programmes.find(p => p.slug === event.target.programme.value) || null;
        const updated = setInitiativeProgramme(editor.value, chosen);
        if (updated !== editor.value) {
            editor.value = updated;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
        close();
    });
    dialog.addEventListener('cancel', () => dialog.remove());
    dialog.showModal();
}

if (typeof document !== 'undefined') {
    // Typing `type: initiative` (or removing it) changes the plan's type
    // without reloading it, so follow the editor too.
    document.addEventListener('DOMContentLoaded', () => {
        const editor = document.getElementById('planEditor');
        if (!editor) return;
        let timer = null;
        editor.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => applyPlanTypeToDocument(editor.value), 300);
        });
    });
}

if (typeof window !== 'undefined') {
    window.openInitiativeRagDialog = openInitiativeRagDialog;
    window.openInitiativeProgrammeDialog = openInitiativeProgrammeDialog;
    window.applyPlanTypeToDocument = applyPlanTypeToDocument;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        PLAN_TYPE_PROJECT,
        PLAN_TYPE_INITIATIVE,
        INITIATIVE_RAG_VALUES,
        INITIATIVE_VIEWS,
        readFrontMatterFields,
        extractPlanType,
        isInitiativePlan,
        isInitiativeFrontMatter,
        normaliseInitiativeRag,
        getInitiativeRag,
        setInitiativeRag,
        setInitiativeProgramme,
        buildInitiativeTemplate,
        initiativeRagLabel,
    };
}
