/**
 * version-history.js — Version history panel for NoodlePlanner.
 *
 * Stores full snapshots of each plan version in localStorage under
 * a per-project key.  Provides restore, download, view (read-only),
 * upload, and automatic retention-based cleanup.
 *
 * Must be loaded after state.js, project-storage.js, script.js.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VERSION_HISTORY_PREFIX = 'noodle_history_';
const VERSION_RETENTION_KEY = 'noodle_version_retention_days';
const DEFAULT_RETENTION_DAYS = 14;
const MAX_VERSIONS_PER_PROJECT = 50; // safety cap to limit localStorage usage
// Each snapshot is a full copy of the plan, so fifty of a 21 KB plan is a
// megabyte: a fifth of the whole localStorage quota for one project (#794).
// History is capped by bytes as well as by count, and is the first thing
// evicted when a plan save hits the quota.
const MAX_HISTORY_BYTES_PER_PROJECT = 512 * 1024;

// ---------------------------------------------------------------------------
// Read-only mode state
// ---------------------------------------------------------------------------

let versionHistoryReadOnly = false;
let versionHistoryOriginalText = null;

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function getVersionHistoryKey(projectId) {
    return VERSION_HISTORY_PREFIX + projectId;
}

function getVersionHistory(projectId) {
    if (typeof projectStoreActive === 'function' && projectStoreActive()) {
        return NoodleStore.getVersionHistory(projectId);
    }
    try {
        const raw = localStorage.getItem(getVersionHistoryKey(projectId));
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        console.error('Error reading version history:', e);
        return [];
    }
}

/**
 * Approximate storage cost of a history array (characters of plan text).
 */
function historyBytes(history) {
    let total = 0;
    for (let i = 0; i < history.length; i++) {
        total += (history[i].planText || '').length + 80;
    }
    return total;
}

/**
 * Drop the oldest entries (history is newest-first) until the array fits
 * the count and byte caps. Returns a new array; the input is not modified.
 */
function trimHistoryToBudget(history) {
    let trimmed = history.slice(0, MAX_VERSIONS_PER_PROJECT);
    while (trimmed.length > 1 && historyBytes(trimmed) > MAX_HISTORY_BYTES_PER_PROJECT) {
        trimmed = trimmed.slice(0, trimmed.length - 1);
    }
    return trimmed;
}

/**
 * Write a project's history. Never lets history block a plan save: on a
 * quota error the older half is dropped and the write retried until it fits,
 * and the user is told. Returns true when the history was written, false
 * (after telling the user) when not even one snapshot fits.
 */
function saveVersionHistory(projectId, history) {
    if (typeof projectStoreActive === 'function' && projectStoreActive()) {
        // IndexedDB has room for the full fifty snapshots; only the count cap
        // applies. Snapshots that have not changed are not rewritten.
        NoodleStore.setVersionHistory(projectId, history.slice(0, MAX_VERSIONS_PER_PROJECT));
        return true;
    }
    const key = getVersionHistoryKey(projectId);
    let entries = trimHistoryToBudget(history);
    let quotaDropped = 0; // entries lost to the quota, over and above the budget cap
    for (;;) {
        try {
            if (entries.length === 0) {
                localStorage.removeItem(key);
            } else {
                localStorage.setItem(key, JSON.stringify(entries));
            }
            if (quotaDropped > 0 && typeof showStorageNotice === 'function') {
                showStorageNotice('history-trimmed',
                    'Browser storage is nearly full: ' + quotaDropped + ' older plan version' + (quotaDropped === 1 ? '' : 's') +
                    ' were removed. Your plan itself is safe.', 'warning', false);
            }
            return true;
        } catch (e) {
            const quota = (typeof isStorageQuotaError === 'function') ? isStorageQuotaError(e) : false;
            if (!quota || entries.length === 0) {
                if (typeof reportStorageFailure === 'function') {
                    reportStorageFailure('version history', e);
                } else {
                    console.error('Error saving version history:', e);
                }
                return false;
            }
            const keep = Math.floor(entries.length / 2);
            if (keep === 0) {
                // Not even one snapshot fits. Leave whatever history is already
                // stored alone rather than deleting it, and say so.
                if (typeof reportStorageFailure === 'function') {
                    reportStorageFailure('version history', e);
                } else {
                    console.error('Error saving version history:', e);
                }
                return false;
            }
            quotaDropped += entries.length - keep;
            entries = entries.slice(0, keep);
        }
    }
}

/**
 * Free localStorage by evicting the older half of every project's version
 * history (and any history that has already shrunk to one entry). Called by
 * saveAllProjects when a plan save hits the quota: the current plan text is
 * always worth more than old snapshots of it. Returns the number of
 * snapshots removed, 0 when there was nothing left to evict.
 */
function freeVersionHistorySpace() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(VERSION_HISTORY_PREFIX) === 0) keys.push(k);
    }
    let removed = 0;
    keys.forEach(function (key) {
        let history;
        try {
            history = JSON.parse(localStorage.getItem(key) || '[]');
        } catch (e) {
            history = [];
        }
        if (!Array.isArray(history) || history.length <= 1) {
            removed += history.length || 0;
            localStorage.removeItem(key);
            return;
        }
        const keep = Math.floor(history.length / 2);
        try {
            localStorage.setItem(key, JSON.stringify(history.slice(0, keep)));
            removed += history.length - keep;
        } catch (e) {
            // Even the smaller write failed: give the whole history up.
            localStorage.removeItem(key);
            removed += history.length;
        }
    });
    return removed;
}

function getRetentionDays() {
    const val = localStorage.getItem(VERSION_RETENTION_KEY);
    return val ? parseInt(val, 10) : DEFAULT_RETENTION_DAYS;
}

function setRetentionDays(days) {
    localStorage.setItem(VERSION_RETENTION_KEY, String(days));
}

// ---------------------------------------------------------------------------
// RAG front matter helper
// ---------------------------------------------------------------------------

function getRagFromFrontMatter(text) {
    const match = text.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    const ragMatch = match[1].match(/^rag:\s*(.+)$/m);
    return ragMatch ? ragMatch[1].trim() : null;
}

function setRagInFrontMatter(text, ragStatus) {
    if (!ragStatus) return text;
    const fmMatch = text.match(/^(---\n)([\s\S]*?)(\n---)/);
    if (fmMatch) {
        let body = fmMatch[2];
        if (/^rag:/m.test(body)) {
            body = body.replace(/^rag:.*$/m, 'rag: ' + ragStatus);
        } else {
            body += '\nrag: ' + ragStatus;
        }
        return fmMatch[1] + body + fmMatch[3] + text.slice(fmMatch[0].length);
    }
    return '---\nrag: ' + ragStatus + '\n---\n' + text;
}

// ---------------------------------------------------------------------------
// Save a version snapshot
// ---------------------------------------------------------------------------

/**
 * Called BEFORE saveCurrentProjectState writes the new plan text.
 * Captures the current editor content as a history entry.
 */
function saveVersionSnapshot(projectId) {
    if (!projectId) return;

    const editor = document.getElementById('planEditor');
    if (!editor || !editor.value.trim()) return;

    const planText = editor.value;
    const version = getVersionFromFrontMatter(planText) || '1.0';
    const date = new Date().toISOString();

    // Determine current RAG status from the status bar dot
    let rag = getRagFromFrontMatter(planText) || '';
    if (!rag) {
        const dot = document.getElementById('statusBarRAG');
        if (dot) {
            if (dot.classList.contains('rag-red')) rag = 'red';
            else if (dot.classList.contains('rag-amber')) rag = 'amber';
            else if (dot.classList.contains('rag-green')) rag = 'green';
            else if (dot.classList.contains('rag-blue')) rag = 'blue';
        }
    }

    const history = getVersionHistory(projectId);

    // Avoid duplicate snapshots — skip if the latest entry has identical text
    // or the same version number (version is bumped on explicit save/export)
    if (history.length > 0 && (history[0].planText === planText || history[0].version === version)) {
        // Update the existing entry's text/date/rag if same version
        if (history[0].version === version) {
            history[0].planText = planText;
            history[0].date = date;
            history[0].rag = rag;
            saveVersionHistory(projectId, history);
        }
        return;
    }

    // Prepend (newest first)
    history.unshift({ version, date, planText, rag });

    // Enforce cap
    if (history.length > MAX_VERSIONS_PER_PROJECT) {
        history.length = MAX_VERSIONS_PER_PROJECT;
    }

    saveVersionHistory(projectId, history);
}

// ---------------------------------------------------------------------------
// Cleanup expired versions
// ---------------------------------------------------------------------------

function cleanupExpiredVersions(projectId) {
    const retentionDays = getRetentionDays();
    const history = getVersionHistory(projectId);
    if (history.length === 0) return;

    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const filtered = history.filter(function (entry) {
        return new Date(entry.date).getTime() >= cutoff;
    });

    if (filtered.length !== history.length) {
        saveVersionHistory(projectId, filtered);
    }
}

// ---------------------------------------------------------------------------
// Restore a version
// ---------------------------------------------------------------------------

function restoreVersion(projectId, index) {
    const history = getVersionHistory(projectId);
    if (index < 0 || index >= history.length) return;

    const entry = history[index];
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    // Exit read-only mode if active
    if (versionHistoryReadOnly) {
        exitReadOnlyView();
    }

    // Restore the plan text then bump the version
    editor.value = entry.planText;
    incrementPlanVersion(editor);

    // Trigger an input event so views refresh
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    // Save the restored state
    if (typeof saveCurrentProjectState === 'function') {
        saveCurrentProjectState();
    }

    setStatusMessage('Restored version ' + entry.version);
    renderVersionHistoryList(projectId);
}

// ---------------------------------------------------------------------------
// Download a version
// ---------------------------------------------------------------------------

function downloadVersion(projectId, index) {
    let planText, version;

    if (index === -1) {
        // Download current version from the editor
        const editor = document.getElementById('planEditor');
        if (!editor) return;
        planText = editor.value;
        version = getVersionFromFrontMatter(planText) || '1.0';
        projectId = projectId || getCurrentProjectId();
    } else {
        const history = getVersionHistory(projectId);
        if (index < 0 || index >= history.length) return;
        const entry = history[index];
        planText = entry.planText;
        version = entry.version;
    }

    const project = loadProject(projectId);
    const safeName = (project ? project.name : 'plan').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = safeName + '_v' + version + '.md';

    const blob = new Blob([planText], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// View a version (read-only)
// ---------------------------------------------------------------------------

function viewVersion(projectId, index) {
    const history = getVersionHistory(projectId);
    if (index < 0 || index >= history.length) return;

    const entry = history[index];
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    // Save original text so we can return
    if (!versionHistoryReadOnly) {
        versionHistoryOriginalText = editor.value;
    }

    versionHistoryReadOnly = true;
    editor.value = entry.planText;
    editor.readOnly = true;
    editor.classList.add('version-readonly');

    // Show read-only banner
    showReadOnlyBanner(entry.version);

    // Trigger re-render
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    // Close the version history panel
    closeVersionHistoryPanel();
}

function showReadOnlyBanner(version) {
    let banner = document.getElementById('versionReadOnlyBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'versionReadOnlyBanner';
        banner.className = 'version-readonly-banner';
        const editorContainer = document.querySelector('.editor-container') || document.getElementById('planEditor')?.parentElement;
        if (editorContainer) {
            editorContainer.insertBefore(banner, editorContainer.firstChild);
        }
    }
    banner.innerHTML = '<span><i class="bi bi-eye"></i> Viewing version ' + version + ' (read-only)</span>' +
        '<button class="btn-sm" onclick="exitReadOnlyView()"><i class="bi bi-x-circle"></i> Exit</button>';
    banner.style.display = 'flex';
}

function returnToCurrentVersion() {
    if (versionHistoryReadOnly) {
        exitReadOnlyView();
    }
    closeVersionHistoryPanel();
}

function exitReadOnlyView() {
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    versionHistoryReadOnly = false;
    editor.readOnly = false;
    editor.classList.remove('version-readonly');

    // Restore original text
    if (versionHistoryOriginalText !== null) {
        editor.value = versionHistoryOriginalText;
        versionHistoryOriginalText = null;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Hide banner
    const banner = document.getElementById('versionReadOnlyBanner');
    if (banner) banner.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Upload a version
// ---------------------------------------------------------------------------

function uploadVersion(projectId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt';
    input.multiple = true;
    input.onchange = function () {
        if (!input.files || input.files.length === 0) return;
        let filesProcessed = 0;
        const totalFiles = input.files.length;

        Array.from(input.files).forEach(function (file) {
            const reader = new FileReader();
            reader.onload = function (e) {
                const planText = e.target.result;
                const version = getVersionFromFrontMatter(planText) || 'uploaded';
                const lastSaved = getLastSavedFromFrontMatter(planText);
                const date = lastSaved ? new Date(lastSaved).toISOString() : new Date().toISOString();
                const rag = getRagFromFrontMatter(planText) || '';

                const history = getVersionHistory(projectId);

                // Skip if a version with the same version number already exists
                const duplicate = history.some(function (entry) {
                    return entry.version === version;
                });

                if (!duplicate) {
                    history.unshift({ version, date, planText, rag });
                    if (history.length > MAX_VERSIONS_PER_PROJECT) {
                        history.length = MAX_VERSIONS_PER_PROJECT;
                    }
                    saveVersionHistory(projectId, history);
                }

                filesProcessed++;
                if (filesProcessed === totalFiles) {
                    renderVersionHistoryList(projectId);
                    setStatusMessage(totalFiles === 1 ? 'Uploaded version added to history' : totalFiles + ' versions uploaded');
                }
            };
            reader.readAsText(file);
        });
    };
    input.click();
}

// ---------------------------------------------------------------------------
// Delete a single version entry
// ---------------------------------------------------------------------------

function deleteVersionEntry(projectId, index) {
    const history = getVersionHistory(projectId);
    if (index < 0 || index >= history.length) return;
    history.splice(index, 1);
    saveVersionHistory(projectId, history);
    renderVersionHistoryList(projectId);
}

// ---------------------------------------------------------------------------
// Panel open / close / render
// ---------------------------------------------------------------------------

function openVersionHistoryPanel() {
    const projectId = getCurrentProjectId();
    if (projectId) {
        cleanupExpiredVersions(projectId);
    }
    renderVersionHistoryList(projectId);
    updateVersionRetentionSelect();
    openDetailPane('versionHistorySection');
}

function closeVersionHistoryPanel() {
    closeDetailPane();
}

function toggleVersionHistoryPanel() {
    const pane = document.getElementById('detailPane');
    const section = document.getElementById('versionHistorySection');
    if (pane && pane.classList.contains('open') && section && section.classList.contains('active')) {
        closeVersionHistoryPanel();
    } else {
        openVersionHistoryPanel();
    }
}

function updateVersionRetentionSelect() {
    const sel = document.getElementById('versionRetentionSelect');
    if (sel) sel.value = String(getRetentionDays());
}

function onRetentionChange(value) {
    setRetentionDays(parseInt(value, 10));
    const projectId = getCurrentProjectId();
    if (projectId) {
        cleanupExpiredVersions(projectId);
        renderVersionHistoryList(projectId);
    }
}

// ---------------------------------------------------------------------------
// Render the version list
// ---------------------------------------------------------------------------

function renderVersionHistoryList(projectId) {
    const container = document.getElementById('versionHistoryList');
    if (!container) return;

    if (!projectId) {
        container.innerHTML = '<np-empty-state>No project selected.</np-empty-state>';
        return;
    }

    const history = getVersionHistory(projectId);

    // Show current version at the top
    let html = '';
    const editor = document.getElementById('planEditor');
    const curVersion = (editor && editor.value.trim()) ? (getVersionFromFrontMatter(editor.value) || '1.0') : null;

    if (editor && editor.value.trim()) {
        const curRag = getRagFromFrontMatter(editor.value) || '';
        const curRagClass = curRag ? 'rag-' + curRag : '';
        html += '<div class="vh-entry vh-entry-current" onclick="returnToCurrentVersion()" style="cursor:pointer" title="Click to return to current version">' +
            '<div class="vh-entry-info">' +
                '<span class="vh-rag-dot ' + curRagClass + '" title="RAG: ' + (curRag || 'none') + '"></span>' +
                '<span class="vh-version">v' + escapeHtml(curVersion) + '</span>' +
                '<span class="vh-date vh-current-label">Current version</span>' +
            '</div>' +
            '<div class="vh-entry-actions">' +
                '<np-button icon-only variant="neutral" size="small" onclick="event.stopPropagation(); downloadVersion(null, -1)" title="Download current" label="Download current">' +
                    '<i class="bi bi-download" slot="icon"></i>' +
                '</np-button>' +
            '</div>' +
        '</div>';
    }

    if (history.length === 0) {
        html += '<np-empty-state>No previous versions yet. Versions are saved automatically when you save your plan.</np-empty-state>';
        container.innerHTML = html;
        return;
    }

    // Sort history by version number descending (newest first)
    // Parse version strings like "1.0", "2.3", "uploaded" into comparable values
    function parseVersionNumber(v) {
        if (!v || v === 'uploaded') return [-1, 0];
        const parts = v.split('.');
        return [parseInt(parts[0], 10) || 0, parseInt(parts[1], 10) || 0];
    }

    const sorted = history.map(function (entry, idx) {
        return { entry: entry, origIdx: idx };
    }).sort(function (a, b) {
        const va = parseVersionNumber(a.entry.version);
        const vb = parseVersionNumber(b.entry.version);
        if (vb[0] !== va[0]) return vb[0] - va[0];
        return vb[1] - va[1];
    });

    sorted.forEach(function (item) {
        const entry = item.entry;
        const idx = item.origIdx;

        // Skip if this entry matches the current version (already shown above)
        if (curVersion && entry.version === curVersion) return;
        const dateObj = new Date(entry.date);
        const dateStr = dateObj.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        const timeStr = dateObj.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        const ragClass = entry.rag ? 'rag-' + entry.rag : '';

        html += '<div class="vh-entry">' +
            '<div class="vh-entry-info">' +
                '<span class="vh-rag-dot ' + ragClass + '" title="RAG: ' + (entry.rag || 'none') + '"></span>' +
                '<span class="vh-version">v' + escapeHtml(entry.version) + '</span>' +
                '<span class="vh-date">' + dateStr + ' ' + timeStr + '</span>' +
            '</div>' +
            '<div class="vh-entry-actions">' +
                '<np-button icon-only variant="neutral" size="small" onclick="viewVersion(\'' + projectId + '\',' + idx + ')" title="View (read-only)" label="View (read-only)">' +
                    '<i class="bi bi-eye" slot="icon"></i>' +
                '</np-button>' +
                '<np-button icon-only variant="neutral" size="small" onclick="downloadVersion(\'' + projectId + '\',' + idx + ')" title="Download" label="Download">' +
                    '<i class="bi bi-download" slot="icon"></i>' +
                '</np-button>' +
                '<np-button icon-only variant="neutral" size="small" onclick="restoreVersion(\'' + projectId + '\',' + idx + ')" title="Restore" label="Restore">' +
                    '<i class="bi bi-arrow-counterclockwise" slot="icon"></i>' +
                '</np-button>' +
                '<np-button icon-only variant="danger" size="small" onclick="deleteVersionEntry(\'' + projectId + '\',' + idx + ')" title="Delete" label="Delete">' +
                    '<i class="bi bi-trash" slot="icon"></i>' +
                '</np-button>' +
            '</div>' +
        '</div>';
    });

    container.innerHTML = html;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Update the version badge in the status bar
// ---------------------------------------------------------------------------

function updateVersionBadge() {
    const badge = document.getElementById('statusBarVersion');
    if (!badge) return;

    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const version = getVersionFromFrontMatter(editor.value);
    badge.textContent = version ? 'v' + version : 'v1.0';
}

// ---------------------------------------------------------------------------
// Persist RAG to front matter whenever it is recalculated
// ---------------------------------------------------------------------------

function persistRagToFrontMatter(ragStatus) {
    if (!ragStatus) return;
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const current = getRagFromFrontMatter(editor.value);
    if (current === ragStatus) return; // no change

    const updated = setRagInFrontMatter(editor.value, ragStatus);
    if (updated !== editor.value) {
        if (typeof setEditorValuePreservingCursor === 'function') {
            setEditorValuePreservingCursor(editor, updated);
        } else {
            editor.value = updated;
        }
    }
}

// ---------------------------------------------------------------------------
// Initialise on load
// ---------------------------------------------------------------------------

function initVersionHistory() {
    const projectId = getCurrentProjectId();
    if (projectId) {
        cleanupExpiredVersions(projectId);
    }
    updateVersionBadge();
}

// Run cleanup on app load, once the store has read its records.
function scheduleInitVersionHistory() {
    if (typeof NoodleStore !== 'undefined' && NoodleStore && typeof NoodleStore.whenReady === 'function') {
        NoodleStore.whenReady().then(initVersionHistory);
    } else {
        initVersionHistory();
    }
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleInitVersionHistory);
} else {
    scheduleInitVersionHistory();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        MAX_VERSIONS_PER_PROJECT,
        MAX_HISTORY_BYTES_PER_PROJECT,
        getVersionHistory,
        saveVersionHistory,
        saveVersionSnapshot,
        trimHistoryToBudget,
        freeVersionHistorySpace,
    };
}
