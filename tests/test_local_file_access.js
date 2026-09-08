/**
 * Local file open/save via the File System Access API, with a download
 * fallback (issue #767).
 *
 * NoodlePlanner's persistence is otherwise entirely browser-storage-based.
 * static/local-file-access.js adds a second, purely client-side save
 * target: a real file on disk, opened and written to via a retained
 * FileSystemFileHandle. This runs the real module in a sandbox with fake
 * File System Access API objects and checks:
 *
 *   1. isSupported() is feature-detection only (no user-agent sniffing) —
 *      it goes true/false purely on whether window.showOpenFilePicker /
 *      showSaveFilePicker exist, exactly as it would for Firefox/Safari
 *      (simulated here by deleting those window methods) vs Chromium/Edge.
 *   2. opening a file links its handle to a project id, and reading it back
 *      is byte-identical (the module never rewrites plan text).
 *   3. saving a linked project writes straight back through the SAME
 *      handle with no picker/dialog call of any kind — this is the "no
 *      re-prompt" guarantee the issue calls out explicitly.
 *   4. saving unchanged content writes unchanged content: the round-trip
 *      guarantee holds at this layer (script.js is responsible for the
 *      version/last_saved bumps that are the app's only allowed edits;
 *      this module must not add any of its own).
 *   5. a write failure (permission revoked, file gone) drops the link and
 *      is reported to the caller instead of failing silently.
 *   6. a project with no linked file gets `null` from saveToLinkedFile, so
 *      script.js knows to fall back to the download flow.
 *   7. cancelling the picker (AbortError) resolves to null, not a thrown
 *      error — the user backing out of the dialog is not a failure.
 *
 * What this file does NOT and cannot verify: the real native OS file-picker
 * dialog, which chromedriver only automates in limited ways (see the PR
 * description for what was checked with a real Selenium-driven browser
 * instead).
 *
 * Run with: node tests/test_local_file_access.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const staticDir = path.join(__dirname, '..', 'packages', 'noodle-web', 'src', 'noodle_web', 'static');

let failures = 0;
function assertTrue(cond, msg) {
    if (!cond) { failures++; console.error('FAIL:', msg); } else { console.log('PASS:', msg); }
}
function assertEqual(actual, expected, msg) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) {
        failures++;
        console.error('FAIL:', msg);
        console.error('  expected:', JSON.stringify(expected));
        console.error('  actual:  ', JSON.stringify(actual));
    } else {
        console.log('PASS:', msg);
    }
}

// --- a fake File System Access API --------------------------------------------

/** A fake FileSystemFileHandle backed by an in-memory string. */
function makeFakeHandle(name, initialText, opts) {
    opts = opts || {};
    let text = initialText;
    const writes = [];
    return {
        name: name,
        writes: writes,           // every write() call, for assertions
        _text: () => text,
        permissionState: opts.permissionState || 'granted',
        queryPermission: async function () { return this.permissionState; },
        requestPermission: async function () { return this.permissionState; },
        getFile: async function () {
            return { name: name, text: async () => text };
        },
        createWritable: async function () {
            if (opts.failCreateWritable) throw new Error(opts.failCreateWritable);
            return {
                write: async function (content) {
                    if (opts.failWrite) throw new Error(opts.failWrite);
                    writes.push(content);
                    text = content;
                },
                close: async function () { /* no-op */ },
            };
        },
    };
}

/** Build a sandbox with the real local-file-access.js loaded, and a fake
 *  window whose showOpenFilePicker/showSaveFilePicker can be present or
 *  absent to simulate Chromium/Edge vs Firefox/Safari. Pass `null` for no
 *  window at all. */
function makeApp(windowOverrides) {
    const sandbox = { console: { log() {}, warn() {}, error() {} } };
    vm.createContext(sandbox);
    if (windowOverrides !== null) {
        sandbox.window = Object.assign({}, windowOverrides);
    }
    vm.runInContext(fs.readFileSync(path.join(staticDir, 'local-file-access.js'), 'utf8'), sandbox, {
        filename: 'local-file-access.js',
    });
    return sandbox;
}

async function main() {
    // --- 1. feature detection is purely showOpenFilePicker/showSaveFilePicker -

    {
        const supported = makeApp({
            showOpenFilePicker: async () => [],
            showSaveFilePicker: async () => ({}),
        });
        assertTrue(supported.LocalFileAccess.isSupported() === true,
            'isSupported() is true when both picker methods exist (Chromium/Edge)');

        const noWindow = makeApp(null);
        assertTrue(noWindow.LocalFileAccess.isSupported() === false,
            'isSupported() is false with no window at all');

        const firefoxLike = makeApp({}); // window exists, but no picker methods
        assertTrue(firefoxLike.LocalFileAccess.isSupported() === false,
            'isSupported() is false when window exists but lacks the picker methods (Firefox/Safari simulation)');

        const partial = makeApp({ showOpenFilePicker: async () => [] }); // missing showSaveFilePicker
        assertTrue(partial.LocalFileAccess.isSupported() === false,
            'isSupported() requires BOTH picker methods, not just one');
    }

    // --- 2, 3, 4. open is byte-identical; save goes through the SAME handle
    //              with no re-prompt; unchanged content round-trips exactly --

    {
        const app = makeApp({ showSaveFilePicker: async () => ({}) });
        const original = '---\nversion: 3.2\n---\nTask one @alex 2d\n  *Subtask @jamie 1d\n';
        const handle = makeFakeHandle('roadmap.md', original);
        app.window.showOpenFilePicker = async () => [handle];

        const picked = await app.LocalFileAccess.pickAndReadFile();
        assertTrue(!!picked, 'pickAndReadFile() resolves with a result');
        assertEqual(picked.name, 'roadmap.md', 'the picked file name is returned');
        assertEqual(picked.text, original, 'the picked file text is byte-identical to the source (no rewriting)');
        assertTrue(picked.handle === handle, 'the raw handle is returned so the caller can link() it');

        app.LocalFileAccess.link('project-1', picked.handle, picked.name);
        assertTrue(app.LocalFileAccess.isLinked('project-1') === true, 'link() marks the project as linked');
        assertEqual(app.LocalFileAccess.getLinkedFileName('project-1'), 'roadmap.md', 'the linked filename is retrievable');
        assertTrue(app.LocalFileAccess.isLinked('project-2') === false, 'a different, unrelated project is not linked');

        // Saving writes straight back through the SAME handle, unchanged
        // content in means unchanged content out, and no picker of any kind
        // is invoked (no re-prompt).
        let pickerCalledDuringSave = false;
        app.window.showSaveFilePicker = async () => { pickerCalledDuringSave = true; return handle; };
        app.window.showOpenFilePicker = async () => { pickerCalledDuringSave = true; return [handle]; };

        const result = await app.LocalFileAccess.saveToLinkedFile('project-1', original);
        assertTrue(result && result.ok === true, 'saveToLinkedFile() succeeds for a linked project');
        assertEqual(result.filename, 'roadmap.md', 'the save result reports the linked filename');
        assertEqual(handle.writes.length, 1, 'exactly one write happened');
        assertEqual(handle.writes[0], original, 'saving unchanged content writes byte-identical content back (round-trip guarantee)');
        assertEqual(handle._text(), original, 'the fake file on disk now holds exactly what was written');
        assertTrue(pickerCalledDuringSave === false, 'no file picker/dialog was invoked while saving — the whole point of retaining the handle');

        // A second save, with a genuine edit, still goes through the same
        // handle with no prompt.
        const edited = original.replace('Task one', 'Task one (renamed)');
        const result2 = await app.LocalFileAccess.saveToLinkedFile('project-1', edited);
        assertTrue(result2.ok === true, 'a second save also succeeds with no prompt');
        assertEqual(handle.writes.length, 2, 'a second write landed on the same handle');
        assertEqual(handle.writes[1], edited, 'the edited content is what got written');
        assertTrue(pickerCalledDuringSave === false, 'still no picker call after a second save');
    }

    // --- 5. a write failure drops the link and is reported, not swallowed -----

    {
        const app = makeApp({});
        const handle = makeFakeHandle('flaky.md', 'original text', { failCreateWritable: 'NotAllowedError' });
        app.LocalFileAccess.link('project-x', handle, 'flaky.md');

        const result = await app.LocalFileAccess.saveToLinkedFile('project-x', 'new text');
        assertTrue(result && result.ok === false, 'a write failure resolves with ok: false, not a thrown error');
        assertEqual(result.filename, 'flaky.md', 'the failure result still reports the filename');
        assertTrue(!!result.error, 'the underlying error is surfaced to the caller');
        assertTrue(app.LocalFileAccess.isLinked('project-x') === false,
            'the link is dropped after a failed write, so the next save does not silently keep failing against a dead handle');
    }

    // --- 5b. a permission that cannot be (re-)granted also fails cleanly ------

    {
        const app = makeApp({});
        const handle = makeFakeHandle('locked.md', 'text', { permissionState: 'denied' });
        app.LocalFileAccess.link('project-y', handle, 'locked.md');

        const result = await app.LocalFileAccess.saveToLinkedFile('project-y', 'new text');
        assertTrue(result && result.ok === false, 'a denied permission resolves with ok: false');
        assertEqual(handle.writes.length, 0, 'no write was attempted once permission was denied');
        assertTrue(app.LocalFileAccess.isLinked('project-y') === false, 'the link is dropped');
    }

    // --- 6. an unlinked project falls through cleanly --------------------------

    {
        const app = makeApp({});
        const result = await app.LocalFileAccess.saveToLinkedFile('never-linked', 'content');
        assertTrue(result === null, 'saveToLinkedFile() returns null (not ok:false) for a project with no linked file, so the caller uses the download fallback instead of reporting an error');
    }

    // --- 7. cancelling the native picker is not an error -----------------------

    {
        const app = makeApp({
            showOpenFilePicker: async () => { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; },
            showSaveFilePicker: async () => ({}),
        });
        const result = await app.LocalFileAccess.pickAndReadFile();
        assertTrue(result === null, 'cancelling the picker (AbortError) resolves to null, not a thrown error');
    }

    // --- 8. unlink() clears the link (e.g. on project deletion) ----------------

    {
        const app = makeApp({});
        const handle = makeFakeHandle('gone.md', 'text');
        app.LocalFileAccess.link('project-z', handle, 'gone.md');
        assertTrue(app.LocalFileAccess.isLinked('project-z') === true, 'sanity: linked before unlink()');
        app.LocalFileAccess.unlink('project-z');
        assertTrue(app.LocalFileAccess.isLinked('project-z') === false, 'unlink() clears the link');
        assertTrue(app.LocalFileAccess.getLinkedFileName('project-z') === null, 'getLinkedFileName() returns null once unlinked');
    }

    // --- 9. no NoodlePlanner backend storage is involved ------------------------
    //
    // This module never calls fetch/XHR at all; its only I/O is the File
    // System Access API objects passed to it. Assert the module source
    // contains no backend call so a future edit that starts routing content
    // through /api/... trips this test rather than shipping silently.

    {
        const source = fs.readFileSync(path.join(staticDir, 'local-file-access.js'), 'utf8');
        // Strip comments first: the module's own doc-comments explain what
        // it must NOT do (and so mention "/api/" and "fetch" in prose),
        // which would otherwise false-positive this check against itself.
        const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        assertTrue(!/\bfetch\s*\(/.test(code), 'local-file-access.js makes no fetch() calls — no backend involvement');
        assertTrue(!/XMLHttpRequest/.test(code), 'local-file-access.js uses no XMLHttpRequest — no backend involvement');
        assertTrue(!/\/api\//.test(code), 'local-file-access.js references no /api/ endpoint in code');
    }
}

main().then(() => {
    if (failures > 0) {
        console.error('\n' + failures + ' test(s) failed');
        process.exit(1);
    }
    console.log('\nAll local file access tests passed');
}).catch((err) => {
    console.error('Uncaught error while running tests:', err);
    process.exit(1);
});
