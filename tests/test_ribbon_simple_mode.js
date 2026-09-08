/**
 * Tests for the simple ribbon (issue #955) -- run the real ribbon.js in a
 * vm sandbox (same pattern as tests/test_whiteboard_viewport.js) and
 * exercise:
 *
 *   1. density persistence -- the full/simple choice round-trips through
 *      loadPersistedState()/savePersistedState() the same way scope/
 *      collapsed already do, defaults to 'full', and never ends up in
 *      anything resembling plan text (it only ever touches localStorage).
 *   2. no functionality lost -- for every tab across every scope
 *      (TABS/PORTFOLIO_TABS/PROGRAMME_TABS) and every contextual tab, the
 *      simple-mode rendering (renderSimpleGroup(), reached via
 *      renderRibbonBody() with ribbonState.density = 'simple') renders
 *      every single button tuple the full-mode rendering does -- same
 *      count, same data-label set, nothing silently dropped. This is the
 *      concrete check behind "simple mode is a density change, not a
 *      feature reduction".
 *
 * ribbon.js is a classic (non-module) script -- like whiteboard.js, its
 * `function` declarations attach to the vm sandbox's global object, but its
 * top-level `const`/`let` bindings (ribbonState, RIBBON_STATE_KEY) do not;
 * they're only reachable from the inside, through the functions defined in
 * the same script (loadPersistedState/savePersistedState/refreshRibbon...).
 * ribbon.js reaches for a handful of other globals unconditionally
 * (document.getElementById, document.documentElement) even for buttons that
 * don't need them, so the sandbox's `document` stub below always answers
 * those two calls; everything else (NavigationController, EditorUndoManager,
 * ...) is read behind `typeof x !== 'undefined'` guards and is simply left
 * undefined here, same as the DOM-optional part of test_whiteboard_viewport.js.
 *
 * Run with: node tests/test_ribbon_simple_mode.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'noodle-web', 'src',
        'noodle_web', 'static', 'ribbon.js'),
    'utf8'
);
const iaSource = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'noodle-web', 'src',
        'noodle_web', 'static', 'ribbon-ia.js'),
    'utf8'
);

let failures = 0;
function assert(condition, msg) {
    if (!condition) {
        failures++;
        console.error('FAIL:', msg);
    } else {
        console.log('PASS:', msg);
    }
}

// ── A tiny in-memory localStorage + no-op document, same shape as the
//    real browser APIs ribbon.js touches unconditionally. ──────────────────
function makeLocalStorage(seed) {
    const store = { ...seed };
    return {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        _store: store,
    };
}

function makeDocumentStub() {
    return {
        documentElement: { getAttribute: () => null },
        getElementById: () => null,
        addEventListener: () => {},
        querySelector: () => null,
        querySelectorAll: () => [],
    };
}

function makeSandbox(localStorage) {
    const sandbox = {
        console,
        document: makeDocumentStub(),
        window: { addEventListener() {} },
        localStorage,
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox;
}

// ── Part 1: density persistence ─────────────────────────────────────────
{
    // No persisted state at all -- density defaults to 'full', and that
    // default is what gets written back out (proxy for ribbonState.density,
    // which isn't itself reachable as a sandbox property -- see file header).
    const ls = makeLocalStorage({});
    const sandbox = makeSandbox(ls);
    sandbox.savePersistedState();
    const written = JSON.parse(ls.getItem('noodleplanner:ribbon-state'));
    assert(written.density === 'full', "density defaults to 'full' with nothing persisted yet");
}

{
    // A previously-saved 'simple' choice is honoured on load, and survives
    // a round trip through save -- same "reload restores it" contract
    // scope/collapsed already have.
    const ls = makeLocalStorage({
        'noodleplanner:ribbon-state': JSON.stringify({ scope: 'project', collapsed: false, density: 'simple' }),
    });
    const sandbox = makeSandbox(ls);
    sandbox.savePersistedState();
    const written = JSON.parse(ls.getItem('noodleplanner:ribbon-state'));
    assert(written.density === 'simple', "a persisted 'simple' choice is loaded and re-saved as 'simple'");
}

{
    // Garbage/unexpected persisted values fall back to 'full' rather than
    // ending up in some third, unrenderable state.
    const ls = makeLocalStorage({
        'noodleplanner:ribbon-state': JSON.stringify({ density: 'ultra-dense' }),
    });
    const sandbox = makeSandbox(ls);
    sandbox.savePersistedState();
    const written = JSON.parse(ls.getItem('noodleplanner:ribbon-state'));
    assert(written.density === 'full', "an unrecognised persisted density value falls back to 'full'");
}

{
    // Never anywhere near plan text: the only thing density persistence
    // touches is the one ribbon-state localStorage key -- pure view-state,
    // same category as scope/collapsed and the whiteboard's own pan/zoom.
    const ls = makeLocalStorage({});
    const sandbox = makeSandbox(ls);
    sandbox.savePersistedState();
    const keys = Object.keys(ls._store);
    assert(keys.length === 1 && keys[0] === 'noodleplanner:ribbon-state',
        'density persistence writes only the ribbon-state localStorage key, nothing else');
}

// ── Part 2: no functionality lost in simple mode ────────────────────────
{
    const iaSandbox = { console };
    vm.createContext(iaSandbox);
    // ribbon-ia.js is a real ES module (`export const`/`export function`) --
    // unlike ribbon.js's plain top-level `function` declarations, `const`
    // wouldn't attach to the sandbox's global object even with `export`
    // stripped (same reason ribbonState itself isn't reachable -- see this
    // file's header comment), so `export const` becomes `var` here
    // specifically to make TABS/PORTFOLIO_TABS/etc. reachable as
    // iaSandbox.TABS below; `export function` just loses the `export`.
    const iaAsScript = iaSource
        .replace(/^export const /gm, 'var ')
        .replace(/^export function /gm, 'function ');
    vm.runInContext(iaAsScript, iaSandbox);

    const ls = makeLocalStorage({});
    const sandbox = makeSandbox(ls);

    const allTabSets = [
        ['TABS (project scope)', iaSandbox.TABS],
        ['PORTFOLIO_TABS', iaSandbox.PORTFOLIO_TABS],
        ['PROGRAMME_TABS', iaSandbox.PROGRAMME_TABS],
        ['CONTEXTUAL_TABS', iaSandbox.CONTEXTUAL_TABS],
    ];

    function labelsFromHtml(html) {
        return Array.from(html.matchAll(/data-label="([^"]*)"/g)).map((m) => m[1]).sort();
    }
    function linkLabelsFromHtml(html) {
        // link: buttons render as <a> with no data-label -- count them by
        // their aria-label's "(opens in a new tab)" suffix instead.
        return Array.from(html.matchAll(/aria-label="([^"]*) \(opens in a new tab\)"/g)).map((m) => m[1]).sort();
    }

    let checked = 0;
    for (const [setName, tabs] of allTabSets) {
        assert(Array.isArray(tabs) && tabs.length > 0, `${setName} loaded from ribbon-ia.js`);
        for (const tab of tabs) {
            for (const group of tab.groups) {
                const fullHtml = sandbox.renderGroup(tab.id, group, false);
                const simpleHtml = sandbox.renderSimpleGroup(tab.id, group, false);

                const fullLabels = [...labelsFromHtml(fullHtml), ...linkLabelsFromHtml(fullHtml)].sort();
                const simpleLabels = [...labelsFromHtml(simpleHtml), ...linkLabelsFromHtml(simpleHtml)].sort();

                assert(
                    JSON.stringify(fullLabels) === JSON.stringify(simpleLabels),
                    `${setName}/${tab.id}/"${group.name}": simple mode renders the exact same buttons as full mode ` +
                    `(full=${JSON.stringify(fullLabels)}, simple=${JSON.stringify(simpleLabels)})`
                );
                checked++;
            }
        }
    }
    assert(checked > 20, `checked a meaningful number of groups across every scope (checked ${checked})`);
}

// ── Part 3: the display-options control always renders, and its menu
//    offers both Full and Simple ──────────────────────────────────────────
{
    const ls = makeLocalStorage({});
    const sandbox = makeSandbox(ls);
    // renderDisplayToggle() renders only the toggle *button* -- the menu's
    // actual popover is a separate function (renderDisplayMenu(), appended
    // straight to .ribbon-shell rather than nested inside the toggle, so it
    // isn't clipped by .ribbon-body's `overflow: hidden` in either density;
    // see that function's own comment) that needs a real DOM (querySelector,
    // getBoundingClientRect) this sandbox doesn't provide. Its shared
    // content half, displayMenuItemsHtml(), has no such DOM dependency and
    // is checked directly here.
    const closedHtml = sandbox.renderDisplayToggle();
    assert(closedHtml.includes('data-action="toggle-display-menu"'), 'the display-options toggle button always renders');
    assert(closedHtml.includes('Ribbon Display Options'), 'the toggle is labelled "Ribbon Display Options"');

    const menuItemsHtml = sandbox.displayMenuItemsHtml();
    assert(/data-density="full"/.test(menuItemsHtml), 'the display menu offers a "full" choice');
    assert(/data-density="simple"/.test(menuItemsHtml), 'the display menu offers a "simple" choice');
    assert(/Full Ribbon/.test(menuItemsHtml), 'the "full" choice is labelled "Full Ribbon"');
    assert(/Simple Ribbon/.test(menuItemsHtml), 'the "simple" choice is labelled "Simple Ribbon"');
}

if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
}
console.log('\nAll tests passed.');
