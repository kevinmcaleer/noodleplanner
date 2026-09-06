/**
 * window-drop.js — the whole window is a drop target for imports (issue #811).
 *
 * Dropping a file anywhere on the page is treated as an import request and
 * routed by extension to the importer that already handles that kind of
 * file from the menus:
 *
 *   .md .markdown .txt   a new project from the plan text
 *   .xlsx .xls           the Excel import wizard
 *   .xml .mpp            MS Project, into a new project
 *   .json                a project export (single or multi-project)
 *
 * Only file drags are handled: the app's own drag and drop (Kanban cards,
 * task rows, columns) carries text data, not files, and is left alone. The
 * editor panel and the Upload tab keep their own drop handlers; drops there
 * are theirs, and this module only clears the overlay for them.
 */

const WINDOW_DROP_MAX_BYTES = 1048576;        // the API's upload limit
const WINDOW_DROP_MAX_MPP_BYTES = 25 * 1048576; // .mpp is read in the browser
const WINDOW_DROP_OWN_HANDLERS = '.editor-panel, #kanbanEditorPanel, #dropZone';

/** What kind of import a dropped file name asks for, or null if none. */
function classifyDroppedFile(name) {
    const ext = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    switch (ext ? ext[1] : '') {
        case 'md':
        case 'markdown':
        case 'txt':
            return 'plan';
        case 'xlsx':
        case 'xls':
            return 'excel';
        case 'xml':
        case 'mpp':
            return 'msproject';
        case 'json':
            return 'json';
        default:
            return null;
    }
}

/** Human-readable list of what can be dropped, for messages. */
const WINDOW_DROP_ACCEPTED = 'a Markdown plan (.md, .txt), an Excel workbook (.xlsx), an MS Project file (.mpp, .xml) or a project export (.json)';

function windowDropIsFileDrag(event) {
    const types = event.dataTransfer && event.dataTransfer.types;
    if (!types) return false;
    return Array.prototype.indexOf.call(types, 'Files') !== -1;
}

function windowDropNotify(kind, text) {
    if (typeof showMessage === 'function') showMessage('editor', kind, text);
    if (typeof setStatusMessage === 'function') setStatusMessage((kind === 'error' ? '⚠ ' : '') + text, 6000);
    if (kind === 'error') console.warn('[drop]', text);
}

/** Bring the project page forward so an imported plan is visible. */
function windowDropShowProjectPage() {
    if (typeof switchToProjectNav === 'function') {
        try { switchToProjectNav(); } catch (e) { /* not fatal */ }
    }
}

async function windowDropImportMsProject(file) {
    // Like the editor drop for plan files: the import lands in a new
    // project rather than overwriting whatever is open.
    if (typeof clearPlanTrackingData === 'function') clearPlanTrackingData();
    if (typeof saveCurrentProjectState === 'function') saveCurrentProjectState();
    const name = file.name.replace(/\.(xml|mpp)$/i, '');
    const project = createProject(name);
    setCurrentProjectId(project.id);
    if (typeof updateProjectBreadcrumb === 'function') updateProjectBreadcrumb(project.name);
    windowDropShowProjectPage();
    await uploadMSProjectFile(file);
    if (typeof saveCurrentProjectState === 'function') saveCurrentProjectState();
    if (typeof refreshProjectSelectors === 'function') refreshProjectSelectors();
}

async function windowDropImportJson(file) {
    const text = await file.text();
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        throw new Error(file.name + ' is not valid JSON');
    }
    let summary;
    if (parsed && parsed.projects && typeof importProjectsFromJSON === 'function') {
        const result = importProjectsFromJSON(parsed);
        summary = result && typeof result === 'object' && 'imported' in result
            ? result.imported + ' project(s) imported from ' + file.name
            : 'Projects imported from ' + file.name;
    } else {
        const project = importProject(text);
        if (!project) throw new Error(file.name + ' is not a NoodlePlanner project export');
        summary = 'Project imported: ' + project.name;
    }
    if (typeof refreshProjectSelectors === 'function') refreshProjectSelectors();
    if (typeof renderProjectsList === 'function') {
        try { renderProjectsList(); } catch (e) { /* portfolio not showing */ }
    }
    return summary;
}

async function windowDropImportFile(file) {
    const kind = classifyDroppedFile(file.name);
    if (!kind) {
        const ext = (file.name.match(/\.[^.]+$/) || ['(no extension)'])[0];
        throw new Error('Cannot import ' + ext + ' files. Drop ' + WINDOW_DROP_ACCEPTED + '.');
    }
    const limit = /\.mpp$/i.test(file.name) ? WINDOW_DROP_MAX_MPP_BYTES : WINDOW_DROP_MAX_BYTES;
    if (file.size > limit) {
        throw new Error(file.name + ' is larger than ' + Math.round(limit / 1048576) + ' MB');
    }

    switch (kind) {
        case 'plan':
            windowDropShowProjectPage();
            await handleEditorFileDrop(file);   // creates a project and reports itself
            return null;
        case 'excel':
            await openExcelImportWizard(file);
            return null;
        case 'msproject':
            await windowDropImportMsProject(file);
            return null;                        // uploadMSProjectFile reports itself
        case 'json':
            return windowDropImportJson(file);
        default:
            return null;
    }
}

/** Import every dropped file, in order; interactive importers take the first only. */
async function handleWindowDrop(files) {
    const list = Array.prototype.slice.call(files || []);
    if (!list.length) return;

    const interactive = (f) => ['excel', 'msproject'].indexOf(classifyDroppedFile(f.name)) !== -1;
    let seenInteractive = false;

    for (const file of list) {
        if (interactive(file)) {
            if (seenInteractive) {
                windowDropNotify('error', 'Skipped ' + file.name + ': drop Excel or MS Project files one at a time');
                continue;
            }
            seenInteractive = true;
        }
        try {
            const summary = await windowDropImportFile(file);
            if (summary) windowDropNotify('success', summary);
        } catch (error) {
            windowDropNotify('error', error.message);
        }
    }
}

function initializeWindowDropImport() {
    if (document.getElementById('windowDropOverlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'windowDropOverlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
        '<div class="window-drop-panel">' +
        '<h2>Drop to import</h2>' +
        '<p>Markdown plan, Excel workbook, MS Project file or project export</p>' +
        '</div>';
    document.body.appendChild(overlay);

    // dragenter/dragleave fire for every element crossed, so a depth counter
    // tells the difference between moving within the window and leaving it.
    let depth = 0;
    const show = () => { overlay.classList.add('active'); };
    const hide = () => { depth = 0; overlay.classList.remove('active'); };

    document.addEventListener('dragenter', (e) => {
        if (!windowDropIsFileDrag(e)) return;
        depth++;
        show();
    }, true);

    document.addEventListener('dragover', (e) => {
        if (!windowDropIsFileDrag(e)) return;
        // allow the drop anywhere, and stop the browser opening the file
        e.preventDefault();
    }, true);

    document.addEventListener('dragleave', (e) => {
        if (!windowDropIsFileDrag(e)) return;
        depth = Math.max(0, depth - 1);
        if (depth === 0) hide();
    }, true);

    // Capture phase: runs before the editor panel's own handler, which stops
    // propagation, so the overlay always clears. Drops on elements with their
    // own importer are left to them.
    document.addEventListener('drop', (e) => {
        if (!windowDropIsFileDrag(e)) return;
        hide();
        if (e.target && e.target.closest && e.target.closest(WINDOW_DROP_OWN_HANDLERS)) return;
        e.preventDefault();
        handleWindowDrop(e.dataTransfer.files);
    }, true);

    window.addEventListener('blur', hide);
    document.addEventListener('dragend', hide, true);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { classifyDroppedFile, WINDOW_DROP_OWN_HANDLERS, WINDOW_DROP_MAX_BYTES, WINDOW_DROP_MAX_MPP_BYTES };
}
