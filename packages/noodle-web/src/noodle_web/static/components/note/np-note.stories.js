import './np-note.js';
import { WB_NOTE_PASTEL_COLOURS } from './np-note.js';

/**
 * Phase A of #1241 (issue #1242): these stories show the note the whiteboard
 * actually ships, not a tidied one. Several of them look crowded. That is the
 * point -- the crowding is the thing the rest of the epic is for, and it was
 * invisible here while <np-note> modelled a `checkbox -> name` row.
 *
 * The component renders into the light DOM using the app's own `.wb-note-*`
 * classes, so what you see is `views/whiteboard.css` doing the styling; see
 * np-note.js's header for why that is deliberate for this one component.
 */

const ROWS = [
    { name: 'Draft the announcement copy', complete: true },
    { name: 'Review with legal', complete: false, resources: ['Sam Smith'] },
    { name: 'Schedule the send', complete: false },
];

const mount = (args) => {
    const note = document.createElement('np-note');
    const {
        rows = [], resources = '', ...attrs
    } = args;
    for (const [key, value] of Object.entries(attrs)) {
        if (value === false || value === null || value === undefined || value === '') continue;
        note.setAttribute(key, value === true ? '' : String(value));
    }
    note.rows = rows;
    note.resources = resources ? String(resources).split(',').map((r) => r.trim()) : [];
    return note;
};

// The board is a canvas, and a note is absolutely sized on it. Give each story
// a little room so the card's own 260x220 is what is being judged.
const onBoard = (story) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:24px;min-height:340px;background:var(--np-surface-alt);';
    wrap.appendChild(story());
    return wrap;
};

export default {
    title: 'Components/WhiteboardNote',
    render: mount,
    decorators: [onBoard],
    argTypes: {
        task: { control: 'text' },
        // The shipped pastel palette. The previous story offered six colours,
        // not one of which is in it.
        colour: { control: { type: 'select' }, options: ['', ...WB_NOTE_PASTEL_COLOURS] },
        parent: { control: 'text' },
        comment: { control: 'text' },
        rows: { control: 'object' },
        width: { control: { type: 'number' } },
        height: { control: { type: 'number' } },
        freeform: { control: 'boolean' },
        thought: { control: 'boolean' },
        'title-only': { control: 'boolean' },
        selected: { control: 'boolean' },
        flash: { control: 'boolean' },
        'park-armed': { control: 'boolean' },
        parking: { control: 'boolean' },
        'link-target': { control: 'boolean' },
        'link-target-invalid': { control: 'boolean' },
        editing: { control: 'boolean' },
    },
    args: {
        task: 'Launch checklist',
        colour: '#FCE38A',
        rows: ROWS,
    },
};

export const Checklist = {};

/**
 * Every conditional row child at once, which no single real note is likely to
 * show but every one of which can appear: a leaf row carrying the lot, a
 * summary row carrying the lot, and a bare row for comparison.
 *
 * This is the story the alignment work is judged against. Read down the three
 * rows: the deliverable badge moves where the name starts, and the trailing
 * cluster begins wherever the optional controls happen to end, so nothing
 * lines up column-wise. None of it was visible here before #1242.
 */
export const KitchenSink = {
    args: {
        task: 'Everything at once',
        colour: '#C7E5FF',
        parent: 'Phase 1',
        height: 300,
        rows: [
            {
                name: 'Leaf with everything',
                complete: false,
                deliverable: 'Widget',
                planningType: 'product',
                date: 'next Friday',
                resources: ['Sam Smith', 'Jo Lee'],
            },
            {
                name: 'Summary with everything',
                hasChildren: true,
                childCount: 4,
                deliverable: 'Report',
                languageHint: true,
                date: '12 Mar',
                resources: ['Alex Ray'],
            },
            { name: 'Bare row', complete: false },
        ],
    },
};

/** The zoomed-out tier: body, footer *and* parent caption all hidden by the
 * app's own CSS, and the coach button with them -- what is left is the noodle
 * handle and the menu, the two worth hitting at 40%. */
export const TitleOnly = {
    args: { task: 'Zoomed-out note', parent: 'Phase 1', 'title-only': true },
};

export const FreeformWithComment = {
    args: {
        task: 'Loose Idea',
        colour: '#CFF4D2',
        freeform: true,
        comment: 'Check with the design team before the next review.',
        rows: [],
    },
};

/** No prose at all (#885): a free-form note with no comment prompts for
 * nothing. The previous component always appended a paragraph, empty or not.
 * The "Add task..." row is the one thing that does follow -- typing into it
 * is how a note stops being free-form, which is why the header no longer
 * carries a button for that. */
export const FreeformEmpty = {
    args: { task: 'Loose Idea', colour: '#CFF4D2', freeform: true, rows: [], resources: '' },
};

/** A text note: a note that is not a task (a commented-out line in the plan,
 * promoted from its menu). Dashed edge, no coach, no noodle handle, no unpin,
 * no footer and no add row -- its body is the text it holds. */
export const TextNote = {
    args: {
        task: 'Ask legal about the licence',
        colour: '#FCE38A',
        thought: true,
        comment: 'They were slow last time -- start early.',
        rows: [],
        resources: '',
    },
};

/** An empty text note invites typing, unlike an empty free-form note: a text
 * note has no task form behind it to hold its text. */
export const TextNoteEmpty = {
    args: { task: 'New thought', colour: '#CFF4D2', thought: true, rows: [], resources: '' },
};

export const EmptyNoSubtasks = {
    args: { task: 'New note', colour: '', rows: [], resources: '' },
};

/** The app's *other* empty string, which the previous component never rendered
 * -- it hardcoded a third one ("No child tasks") that the app never shows. */
export const EmptyLinkedNotes = {
    args: { task: 'Parent note', rows: [], resources: '', 'linked-notes': 3 },
};

export const Selected = { args: { selected: true } };
export const Flash = { args: { flash: true } };
export const ParkArmed = { args: { 'park-armed': true } };
export const Parking = { args: { parking: true } };
export const LinkTarget = { args: { 'link-target': true } };
export const LinkTargetInvalid = { args: { 'link-target-invalid': true } };
export const TitleBeingEdited = { args: { editing: true } };

/** Row-level dependency drop targets, valid and invalid. */
export const DependencyRowTargets = {
    args: {
        task: 'Drop a dependency here',
        rows: [
            { name: 'Valid target', depTarget: 'valid' },
            { name: 'Invalid target (summary)', hasChildren: true, childCount: 2, depTarget: 'invalid' },
            { name: 'Ordinary row' },
        ],
    },
};

/** At the minimum note width the name collapses first and the trailing cluster
 * is then clipped by the card's own `overflow: hidden`. */
export const MinimumWidth = {
    args: {
        task: 'Narrow',
        width: 160,
        height: 200,
        rows: [
            { name: 'A fairly long child task name', date: '12 Mar', resources: ['Sam Smith'] },
            { name: 'Short' },
        ],
    },
};

/**
 * The alignment matrix (#1243).
 *
 * One note per width, each carrying the permutations that used to misalign:
 * bare; deliverable; date chip; summary with a count badge; and 0/1/3/6
 * assignees. Read *down* a card -- the checkboxes, the names and the trailing
 * gutter should each sit on one vertical line whatever a given row happens to
 * carry. Before the gutter existed they did not, and that is the whole of the
 * reported problem.
 *
 * Read *across* the three cards for the degradation tiers: at 260 everything
 * is reserved; at 220 the planning hint has stopped reserving; at 160 the
 * deliverable badge has too and the people slot is down to an overflow chip
 * and the assign control.
 */
export const AlignmentMatrix = {
    render: () => {
        const rows = [
            { name: 'Bare row' },
            { name: 'With a deliverable', deliverable: 'Widget' },
            { name: 'With a date', date: 'next Friday' },
            { name: 'Summary', hasChildren: true, childCount: 4 },
            { name: 'One assignee', resources: ['Sam Smith'] },
            { name: 'Three assignees', resources: ['Sam Smith', 'Jo Lee', 'Alex Ray'] },
            {
                name: 'Six assignees',
                resources: ['Sam Smith', 'Jo Lee', 'Alex Ray', 'Kim Ito', 'Ro Patel', 'Max Fry'],
            },
            { name: 'A planning hint', planningType: 'activity' },
            {
                name: 'Everything',
                deliverable: 'Report',
                date: '12 Mar',
                planningType: 'product',
                resources: ['Sam Smith', 'Jo Lee'],
            },
        ];
        const strip = document.createElement('div');
        strip.style.cssText = 'display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap;';
        for (const width of [400, 260, 220, 160]) {
            strip.appendChild(mount({
                task: `${width}px`, colour: '#FFF3B0', width, height: 340, rows,
                resources: 'Sam Smith, Jo Lee',
            }));
        }
        return strip;
    },
};

/** Every shipped swatch, so the derived text colour can be checked against all
 * ten in both themes rather than against whichever one a story happened to pick. */
export const EveryPaletteColour = {
    render: () => {
        const strip = document.createElement('div');
        strip.style.cssText = 'display:flex;flex-wrap:wrap;gap:16px;';
        for (const colour of WB_NOTE_PASTEL_COLOURS) {
            strip.appendChild(mount({
                task: colour,
                colour,
                width: 200,
                height: 150,
                rows: [{ name: 'Readable?', complete: false }],
                resources: 'Sam Smith',
            }));
        }
        return strip;
    },
};
