/**
 * phone-commands.js -- the ribbon's commands on a phone (#1382, epic #1376).
 *
 * The phone layout hides the ribbon (#1380), so its commands need another
 * home. Two:
 *
 * 1. **⋯ in the app bar** opens every command for the current view as a
 *    bottom sheet (<np-action-sheet>), grouped the way the ribbon is: the
 *    view's contextual tab first (Gantt Tools, Board Tools, RAID Log ...),
 *    then Home, Plan, Track, Resources, Report and View. Each shows its
 *    label with its help text underneath -- on a desktop that text is a
 *    hover-only tooltip. Undo and Redo sit at the top. The list comes from
 *    ribbon.js's ribbonCommandSections(), i.e. from ribbon-ia.js through the
 *    ribbon's own resolver, so the phone cannot fall out of step with it.
 *    A command that opens a menu on the ribbon (Export, Import, Group by ...)
 *    opens that menu as a second sheet here: ribbon.js's openFormatMenu()
 *    hands it over.
 *
 * 2. **A floating "+"** (<np-fab>) runs the current view's main create
 *    action (CREATE_FOR_VIEW in ribbon-ia.js), and is hidden on views with
 *    none.
 */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);

    let sheet = null;
    let fab = null;
    let commands = new Map();
    let choices = [];
    let createCommand = null;

    function isPhone() {
        return document.documentElement.dataset.layout === 'phone';
    }

    function undoState() {
        const undo = typeof EditorUndoManager !== 'undefined' ? EditorUndoManager : null;
        return {
            canUndo: !!(undo && undo.canUndo()),
            canRedo: !!(undo && undo.canRedo()),
        };
    }

    function toolbar() {
        const state = undoState();
        return [
            { id: 'undo', label: 'Undo', icon: 'undo', disabled: !state.canUndo, keepOpen: true },
            { id: 'redo', label: 'Redo', icon: 'redo', disabled: !state.canRedo, keepOpen: true },
        ];
    }

    /** Open the ⋯ sheet: the current view's ribbon commands. */
    async function openCommands(opener) {
        if (!sheet || typeof ribbonCommandSections !== 'function') return;
        const sections = await ribbonCommandSections();
        commands = new Map();
        const view = typeof NavigationController !== 'undefined' ? NavigationController.getCurrentView() : null;
        const label = (window.NoodleViewCatalogue && view && window.NoodleViewCatalogue.label(view)) || 'Commands';
        sheet.heading = label;
        sheet.toolbar = toolbar();
        sheet.sections = sections.map((section) => ({
            id: section.id,
            label: section.label,
            items: section.items.map((item) => {
                const id = `cmd:${section.id}:${item.label}`;
                commands.set(id, item);
                return {
                    id,
                    label: item.label,
                    help: item.help,
                    icon: item.icon,
                    disabled: item.disabled,
                    active: item.active,
                };
            }),
        }));
        sheet.dataset.purpose = 'commands';
        sheet.open(opener || moreButton());
    }

    /** Open a ribbon menu's choices (Export -> PDF, Excel ...) as a sheet. */
    function openChoices(label, formats) {
        if (!sheet) return;
        choices = formats || [];
        sheet.heading = label;
        sheet.toolbar = [];
        sheet.sections = [{
            id: 'choices',
            items: choices.map((choice, index) => ({ id: `choice:${index}`, label: choice.label })),
        }];
        sheet.dataset.purpose = 'choices';
        // The command sheet that asked for this is closing (it was a tap on
        // one of its items); give it a frame to go before this one opens.
        requestAnimationFrame(() => sheet.open(moreButton()));
    }

    function moreButton() {
        return $('phoneMoreBtn');
    }

    function onSelect(event) {
        const id = event.detail.id;
        const purpose = sheet.dataset.purpose;
        if (purpose === 'commands') {
            if (id === 'undo' || id === 'redo') {
                if (typeof EditorUndoManager !== 'undefined') EditorUndoManager[id]();
                sheet.toolbar = toolbar();
                return;
            }
            const item = commands.get(id);
            if (!item) return;
            if (item.href) {
                window.open(item.href, '_blank', 'noopener');
                return;
            }
            // After the sheet has closed, so a command that opens its own
            // choices (openChoices above) opens into a free sheet.
            requestAnimationFrame(() => runRibbonCommand(item.scopeId, item.label));
        } else if (purpose === 'choices') {
            const choice = choices[Number(id.split(':')[1])];
            if (choice) choice.run();
        }
    }

    async function refreshFab() {
        if (!fab) return;
        const view = typeof NavigationController !== 'undefined' ? NavigationController.getCurrentView() : null;
        createCommand = (isPhone() && view && typeof ribbonCreateCommand === 'function')
            ? await ribbonCreateCommand(view)
            : null;
        // The Tasks view on a phone adds with its quick-add field (#1385),
        // which the button would sit on top of.
        if (view === 'tasks' && document.getElementById('planQuickAdd')) createCommand = null;
        fab.hidden = !createCommand;
        if (createCommand) fab.setAttribute('label', createCommand.label);
    }

    function init() {
        sheet = $('phoneSheet');
        fab = $('phoneFab');
        const more = moreButton();
        if (more) more.addEventListener('click', () => openCommands(more));
        if (sheet) sheet.addEventListener('select', onSelect);
        if (fab) {
            fab.addEventListener('click', () => { if (createCommand) createCommand.run(); });
        }
        document.addEventListener('undostatechange', () => {
            if (sheet && sheet.isOpen && sheet.dataset.purpose === 'commands') sheet.toolbar = toolbar();
        });
        document.addEventListener('viewchange', refreshFab);
        document.addEventListener('layoutchange', () => {
            if (!isPhone() && sheet && sheet.dataset.purpose !== 'projects') sheet.close();
            refreshFab();
        });
        refreshFab();
    }

    window.NoodlePhoneCommands = { openCommands, openChoices, refreshFab };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
