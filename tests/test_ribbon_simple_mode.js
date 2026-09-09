/**
 * Tests for the simple ribbon (issue #955) and the combined display
 * selector (issue #1027) -- run the real ribbon.js in a vm sandbox (same
 * pattern as tests/test_whiteboard_viewport.js) and exercise:
 *
 *   1. displayMode persistence -- the tabs/simple/full choice round-trips
 *      through loadPersistedState()/savePersistedState() the same way scope
 *      already does, defaults to 'full', migrates a pre-#1027 persisted
 *      `collapsed`+`density` pair, and never ends up in anything resembling
 *      plan text (it only ever touches localStorage).
 *   2. no functionality lost -- for every tab across every scope
 *      (TABS/PORTFOLIO_TABS/PROGRAMME_TABS) and every contextual tab, the
 *      simple-mode rendering (renderSimpleGroup(), reached via
 *      renderRibbonBody() with ribbonState.displayMode = 'simple') renders
 *      every single button tuple the full-mode rendering does -- same
 *      count, same data-label set, nothing silently dropped. This is the
 *      concrete check behind "simple mode is a display-mode change, not a
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

// A minimal stand-in for script.js's real (DOM-based) escapeHtml() -- good
// enough for this sandbox's purposes (ribbon-ia.js's group/button names are
// static, safe strings; this just proves the call site works at all).
function escapeHtmlStub(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function makeSandbox(localStorage) {
    const sandbox = {
        console,
        document: makeDocumentStub(),
        window: { addEventListener() {} },
        localStorage,
        escapeHtml: escapeHtmlStub,
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox;
}

// ── Part 1: displayMode persistence (#1027) ─────────────────────────────
{
    // No persisted state at all -- displayMode defaults to 'full', and that
    // default is what gets written back out (proxy for ribbonState.displayMode,
    // which isn't itself reachable as a sandbox property -- see file header).
    const ls = makeLocalStorage({});
    const sandbox = makeSandbox(ls);
    sandbox.savePersistedState();
    const written = JSON.parse(ls.getItem('noodleplanner:ribbon-state'));
    assert(written.displayMode === 'full', "displayMode defaults to 'full' with nothing persisted yet");
}

{
    // A previously-saved 'simple' choice is honoured on load, and survives
    // a round trip through save -- same "reload restores it" contract
    // scope already has.
    const ls = makeLocalStorage({
        'noodleplanner:ribbon-state': JSON.stringify({ scope: 'project', displayMode: 'simple' }),
    });
    const sandbox = makeSandbox(ls);
    sandbox.savePersistedState();
    const written = JSON.parse(ls.getItem('noodleplanner:ribbon-state'));
    assert(written.displayMode === 'simple', "a persisted 'simple' choice is loaded and re-saved as 'simple'");
}

{
    // A persisted 'tabs' choice (Just Tabs) round-trips too.
    const ls = makeLocalStorage({
        'noodleplanner:ribbon-state': JSON.stringify({ scope: 'project', displayMode: 'tabs' }),
    });
    const sandbox = makeSandbox(ls);
    sandbox.savePersistedState();
    const written = JSON.parse(ls.getItem('noodleplanner:ribbon-state'));
    assert(written.displayMode === 'tabs', "a persisted 'tabs' choice is loaded and re-saved as 'tabs'");
}

{
    // Garbage/unexpected persisted values fall back to 'full' rather than
    // ending up in some third, unrenderable state.
    const ls = makeLocalStorage({
        'noodleplanner:ribbon-state': JSON.stringify({ displayMode: 'ultra-dense' }),
    });
    const sandbox = makeSandbox(ls);
    sandbox.savePersistedState();
    const written = JSON.parse(ls.getItem('noodleplanner:ribbon-state'));
    assert(written.displayMode === 'full', "an unrecognised persisted displayMode value falls back to 'full'");
}

// ── Part 1b: migrating the pre-#1027 collapsed+density pair ────────────
{
    // A browser that persisted state under the old shape before this
    // release (collapsed: true) migrates to 'tabs' -- collapsed took
    // priority over density in the old orthogonal model (a collapsed
    // simple ribbon still showed only the tab strip), so 'tabs' is the
    // only correct migration regardless of what density said.
    const ls = makeLocalStorage({
        'noodleplanner:ribbon-state': JSON.stringify({ scope: 'project', collapsed: true, density: 'simple' }),
    });
    const sandbox = makeSandbox(ls);
    sandbox.savePersistedState();
    const written = JSON.parse(ls.getItem('noodleplanner:ribbon-state'));
    assert(written.displayMode === 'tabs', "a persisted collapsed:true migrates to displayMode 'tabs'");
}

{
    // Old shape, not collapsed, density 'simple' -> migrates to 'simple'.
    const ls = makeLocalStorage({
        'noodleplanner:ribbon-state': JSON.stringify({ scope: 'project', collapsed: false, density: 'simple' }),
    });
    const sandbox = makeSandbox(ls);
    sandbox.savePersistedState();
    const written = JSON.parse(ls.getItem('noodleplanner:ribbon-state'));
    assert(written.displayMode === 'simple', "old collapsed:false + density:'simple' migrates to displayMode 'simple'");
}

{
    // Old shape, not collapsed, density 'full' (or absent) -> migrates to 'full'.
    const ls = makeLocalStorage({
        'noodleplanner:ribbon-state': JSON.stringify({ scope: 'project', collapsed: false }),
    });
    const sandbox = makeSandbox(ls);
    sandbox.savePersistedState();
    const written = JSON.parse(ls.getItem('noodleplanner:ribbon-state'));
    assert(written.displayMode === 'full', "old collapsed:false with no density migrates to displayMode 'full'");
}

{
    // Never anywhere near plan text: the only thing displayMode persistence
    // touches is the one ribbon-state localStorage key -- pure view-state,
    // same category as scope and the whiteboard's own pan/zoom.
    const ls = makeLocalStorage({});
    const sandbox = makeSandbox(ls);
    sandbox.savePersistedState();
    const keys = Object.keys(ls._store);
    assert(keys.length === 1 && keys[0] === 'noodleplanner:ribbon-state',
        'displayMode persistence writes only the ribbon-state localStorage key, nothing else');
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

// ── Part 3: the display selector always renders, and its menu offers all
//    three modes (#1027) ─────────────────────────────────────────────────
{
    const ls = makeLocalStorage({});
    const sandbox = makeSandbox(ls);
    // renderDisplaySelector() renders only the toggle *button* -- the menu's
    // actual popover is a separate function (renderDisplayMenu(), appended
    // straight to .ribbon-shell rather than nested inside the toggle, so it
    // isn't clipped by .ribbon-body's `overflow: hidden`; see that
    // function's own comment) that needs a real DOM (querySelector,
    // getBoundingClientRect) this sandbox doesn't provide. Its shared
    // content half, displayMenuItemsHtml(), has no such DOM dependency and
    // is checked directly here.
    const closedHtml = sandbox.renderDisplaySelector();
    assert(closedHtml.includes('data-action="toggle-display-menu"'), 'the display-selector toggle button always renders');
    assert(closedHtml.includes('Ribbon Display Options'), 'the toggle is labelled "Ribbon Display Options"');
    assert(!/<svg/.test(closedHtml), 'the toggle shows no icon -- just the dropdown arrow (#1027)');

    const menuItemsHtml = sandbox.displayMenuItemsHtml();
    assert(/data-display-mode="tabs"/.test(menuItemsHtml), 'the display menu offers a "tabs" choice');
    assert(/data-display-mode="simple"/.test(menuItemsHtml), 'the display menu offers a "simple" choice');
    assert(/data-display-mode="full"/.test(menuItemsHtml), 'the display menu offers a "full" choice');
    assert(/Just Tabs/.test(menuItemsHtml), 'the "tabs" choice is labelled "Just Tabs"');
    assert(/Simple Ribbon/.test(menuItemsHtml), 'the "simple" choice is labelled "Simple Ribbon"');
    assert(/Full Ribbon/.test(menuItemsHtml), 'the "full" choice is labelled "Full Ribbon"');
}

// ── Part 4: renderTabStrip() no longer renders a separate collapse button
//    -- the display selector is the only control left (#1027) ─────────────
{
    const ls = makeLocalStorage({});
    const sandbox = makeSandbox(ls);
    // renderTabStrip() needs an `ia`-shaped object (tabsForScope()) -- a
    // minimal stub is enough since this only checks the collapse button is
    // gone and the selector is present.
    const iaStub = { tabsForScope: () => [{ id: 'home', label: 'Home' }] };
    const html = sandbox.renderTabStrip(iaStub, null);
    assert(!html.includes('toggle-collapse'), 'the old separate collapse button no longer renders');
    assert(!html.includes('ribbon-collapse-btn'), 'the old .ribbon-collapse-btn class no longer renders');
    assert(html.includes('toggle-display-menu'), 'the combined display selector renders in the tab strip');
}

if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
}
console.log('\nAll tests passed.');
