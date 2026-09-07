/**
 * local-file-access.js — open/save plan files on the user's real filesystem
 * (issue #767).
 *
 * NoodlePlanner's persistence is otherwise entirely browser-storage-based
 * (project-storage.js / project-store.js — localStorage or IndexedDB). This
 * module adds a second, optional save target: a real file on disk, opened
 * and written to entirely client-side. The file's bytes never pass through
 * the FastAPI server — there is no `/api/...` call anywhere in this module.
 *
 * Two paths, chosen purely by feature detection (never user-agent sniffing):
 *
 *  - File System Access API (Chromium/Edge): showOpenFilePicker() returns a
 *    FileSystemFileHandle, which link() retains here, keyed by project id,
 *    for the lifetime of the tab. Saving that project (saveToLinkedFile)
 *    writes straight back to the handle via createWritable() — no dialog,
 *    no re-prompt.
 *
 *    The handle is *not* persisted across a reload (structured-cloning it
 *    into IndexedDB is possible in supporting browsers but adds real
 *    complexity — permission re-prompts on restore, staleness if the file
 *    moved — and is out of scope here; see the PR description). Reloading
 *    the page loses the live link, and the project falls back to the normal
 *    download-based save, same as browsers without the API at all.
 *
 *  - Everywhere else (Firefox, Safari, or after a reload): no native
 *    picker/handle is available. isSupported() reports that, so callers
 *    (script.js) can fall back to the existing upload-then-download flow and
 *    say so plainly in the UI, rather than silently behaving differently.
 *
 * This module only manages *handles* and raw text; it never edits plan
 * content (front-matter version bumps etc. stay in script.js, applied
 * identically regardless of the save destination) and never touches
 * localStorage/IndexedDB itself (script.js still calls createProject /
 * saveProject so a file opened this way gets a normal project entry too).
 */
(function (root) {
    'use strict';

    /** Feature-detect the File System Access API. Never user-agent sniffing. */
    function isSupported() {
        return typeof window !== 'undefined' &&
            typeof window.showOpenFilePicker === 'function' &&
            typeof window.showSaveFilePicker === 'function';
    }

    // projectId -> { handle: FileSystemFileHandle, name: string }
    // In-memory only — see the module comment above for why this does not
    // survive a reload.
    const linkedFiles = new Map();

    function isLinked(projectId) {
        return !!projectId && linkedFiles.has(projectId);
    }

    function getLinkedFileName(projectId) {
        const entry = linkedFiles.get(projectId);
        return entry ? entry.name : null;
    }

    /** Record a handle for a project after it (or its content) has loaded. */
    function link(projectId, handle, name) {
        linkedFiles.set(projectId, { handle: handle, name: name });
    }

    /** Drop the link, e.g. when the project is deleted or a write fails permanently. */
    function unlink(projectId) {
        linkedFiles.delete(projectId);
    }

    /**
     * Open a .md file from disk via the native picker. Resolves to
     * { handle, name, text } on success, or null if the user cancelled the
     * picker (AbortError). Throws on any other failure. Returns null
     * immediately, without prompting, when the API is unsupported.
     *
     * Does not touch project storage or link() itself — the caller decides
     * what project (if any) this becomes.
     */
    async function pickAndReadFile() {
        if (!isSupported()) return null;
        let handles;
        try {
            handles = await window.showOpenFilePicker({
                id: 'noodleplanner-plan',
                types: [{
                    description: 'NoodlePlanner plan (Markdown)',
                    accept: { 'text/markdown': ['.md'] },
                }],
                excludeAcceptAllOption: false,
                multiple: false,
            });
        } catch (error) {
            if (error && error.name === 'AbortError') return null; // user cancelled
            throw error;
        }
        const handle = handles[0];
        const file = await handle.getFile();
        const text = await file.text();
        return { handle: handle, name: file.name, text: text };
    }

    /**
     * Write `content` back to the file linked to `projectId`, verbatim — no
     * dialog, no mutation of the string. Resolves to { ok: true, filename }
     * on success. Resolves to { ok: false, error, filename } when the write
     * itself fails (permission revoked, file/directory gone, etc.) and drops
     * the link so a later save does not keep failing silently against a
     * handle that no longer works. Resolves to null when `projectId` has no
     * linked file at all, so the caller knows to use the download fallback
     * instead of treating this as an error.
     */
    async function saveToLinkedFile(projectId, content) {
        const entry = linkedFiles.get(projectId);
        if (!entry) return null;
        try {
            if (typeof entry.handle.queryPermission === 'function') {
                let permission = await entry.handle.queryPermission({ mode: 'readwrite' });
                if (permission !== 'granted' && typeof entry.handle.requestPermission === 'function') {
                    permission = await entry.handle.requestPermission({ mode: 'readwrite' });
                }
                if (permission !== 'granted') {
                    throw new Error('Permission to write to ' + entry.name + ' was not granted');
                }
            }
            const writable = await entry.handle.createWritable();
            await writable.write(content);
            await writable.close();
            return { ok: true, filename: entry.name };
        } catch (error) {
            linkedFiles.delete(projectId);
            return { ok: false, error: error, filename: entry.name };
        }
    }

    const api = {
        isSupported: isSupported,
        isLinked: isLinked,
        getLinkedFileName: getLinkedFileName,
        link: link,
        unlink: unlink,
        pickAndReadFile: pickAndReadFile,
        saveToLinkedFile: saveToLinkedFile,
    };

    root.LocalFileAccess = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
