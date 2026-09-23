/**
 * The Gantt's coordinate model and drag edits (#787).
 *
 * gantt-scale.js is pure: zoom <-> slider, header bands derived from pixel
 * density, snap units, and the token-aware task-line editors. The drag edit
 * (engine/gantt-drag.js) is exercised against the real scheduler, which is
 * the point of it: what the preview shows is what `localParse` makes of the
 * edited plan.
 *
 * Run with: node --test tests/test_gantt_scale.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import GanttScale from '../packages/noodle-web/src/noodle_web/static/gantt-scale.js';
import planModel from '../packages/noodle-web/src/noodle_web/static/plan-model.js';
import { planDragEdit, previewDrag, dragCalendar } from '../packages/noodle-web/src/noodle_web/static/engine/gantt-drag.js';
import { localParse } from '../packages/noodle-web/src/noodle_web/static/engine/local-parse.js';

const G = GanttScale;
const inject = { PlanModel: planModel.PlanModel, GanttScale };

// ----- zoom ------------------------------------------------------------

test('the default pixel density is the Days detent the control shows', () => {
    assert.equal(G.DEFAULT_PIXELS_PER_DAY, G.detentByName('days').pixelsPerDay);
    assert.equal(G.exactDetent(G.DEFAULT_PIXELS_PER_DAY), 'days');
});

test('slider <-> pixels per day round-trips across the whole range', () => {
    for (const ppd of [0.5, 1, 2.2, 3, 5, 8.7, 12, 28, 48]) {
        const back = G.sliderToPixelsPerDay(G.pixelsPerDayToSlider(ppd), { snap: false });
        assert.ok(Math.abs(back - ppd) / ppd < 0.01, `${ppd} -> ${back}`);
    }
    assert.equal(G.sliderToPixelsPerDay(0, { snap: false }), G.MIN_PIXELS_PER_DAY);
    assert.equal(G.sliderToPixelsPerDay(G.SLIDER_MAX, { snap: false }), G.MAX_PIXELS_PER_DAY);
});

test('the slider is monotonic and lands on each named detent', () => {
    let previous = 0;
    for (let pos = 0; pos <= G.SLIDER_MAX; pos += 5) {
        const ppd = G.sliderToPixelsPerDay(pos);
        assert.ok(ppd >= previous, `not monotonic at ${pos}`);
        previous = ppd;
    }
    for (const detent of G.DETENTS) {
        const pos = G.pixelsPerDayToSlider(detent.pixelsPerDay);
        assert.equal(G.sliderToPixelsPerDay(pos + 3), detent.pixelsPerDay, detent.name);
    }
});

test('nearestDetent and exactDetent', () => {
    assert.equal(G.nearestDetent(26), 'days');
    assert.equal(G.nearestDetent(1.2), 'years');
    assert.equal(G.nearestDetent(4.4), 'months');
    assert.equal(G.exactDetent(4.4), null);
    assert.equal(G.exactDetent(12), 'weeks');
});

test('anchoredScrollLeft keeps the date under the anchor fixed', () => {
    const scrollLeft = 1400, anchor = 300, oldPpd = 28, newPpd = 5;
    const dayBefore = (scrollLeft + anchor) / oldPpd;
    const next = G.anchoredScrollLeft(scrollLeft, anchor, oldPpd, newPpd);
    assert.ok(Math.abs((next + anchor) / newPpd - dayBefore) < 1e-9);
    // never negative
    assert.equal(G.anchoredScrollLeft(0, 10, 28, 1), 0);
});

// ----- header bands ----------------------------------------------------

const FROM = G.dayOf('2026-01-01');
const TO = G.dayOf('2027-12-31');

test('header bands are always two rows, coarse over fine, chosen by density', () => {
    const expectations = [[28, 'week', 'day'], [12, 'month', 'week'], [5, 'quarter', 'month'],
        [3, 'quarter', 'month'], [1, 'year', 'quarter'], [0.5, 'year', 'quarter']];
    for (const [ppd, coarse, fine] of expectations) {
        const bands = G.headerBands(FROM, TO, ppd);
        assert.equal(bands.length, 2, `ppd ${ppd}`);
        assert.deepEqual(bands.map(b => b.unit), [coarse, fine], `ppd ${ppd}`);
    }
});

test('every band exactly tiles the chart range at every zoom', () => {
    for (let pos = 0; pos <= G.SLIDER_MAX; pos += 50) {
        const ppd = G.sliderToPixelsPerDay(pos, { snap: false });
        for (const band of G.headerBands(FROM, TO, ppd)) {
            let cursor = FROM;
            for (const cell of band.cells) {
                assert.equal(cell.start, cursor, `gap in ${band.unit} band at ppd ${ppd}`);
                assert.ok(cell.days > 0);
                assert.ok(Math.abs(cell.left - (cell.start - FROM) * ppd) < 1e-9);
                cursor += cell.days;
            }
            assert.equal(cursor, TO + 1, `${band.unit} band does not end at the range end`);
        }
    }
});

test('no header label is wider than its cell at any zoom', () => {
    for (let pos = 0; pos <= G.SLIDER_MAX; pos += 25) {
        const ppd = G.sliderToPixelsPerDay(pos, { snap: false });
        for (const band of G.headerBands(G.dayOf('2026-02-11'), G.dayOf('2026-09-03'), ppd)) {
            for (const cell of band.cells) {
                if (!cell.label) continue;
                assert.ok(G.labelWidth(cell.label) <= cell.width,
                    `"${cell.label}" (${G.labelWidth(cell.label)}px) overflows ${cell.width}px at ppd ${ppd}`);
            }
        }
    }
});

test('weeks start on Monday and months on the 1st, across a DST change', () => {
    const bands = G.headerBands(G.dayOf('2026-03-20'), G.dayOf('2026-04-10'), 28);
    const weeks = bands[0].cells;
    assert.equal(G.isoOf(weeks[1].start), '2026-03-23');   // a Monday
    assert.equal(weeks[1].days, 7);
    assert.equal(G.isoOf(weeks[2].start), '2026-03-30');   // straddles the UK clock change
    const months = G.headerBands(G.dayOf('2026-01-15'), G.dayOf('2026-04-15'), 5)[1].cells;
    assert.deepEqual(months.map(c => G.isoOf(c.start)), ['2026-01-15', '2026-02-01', '2026-03-01', '2026-04-01']);
    assert.equal(months[1].days, 28);
});

// ----- snapping --------------------------------------------------------

test('the snap unit is never narrower than MIN_SNAP_PX on screen', () => {
    for (let pos = 0; pos <= G.SLIDER_MAX; pos += 10) {
        const ppd = G.sliderToPixelsPerDay(pos, { snap: false });
        const unit = G.snapUnit(ppd);
        assert.ok(unit.days * ppd >= G.MIN_SNAP_PX - 1e-9, `ppd ${ppd}: ${unit.unit}`);
    }
    assert.equal(G.snapUnit(28).unit, 'day');
    assert.equal(G.snapUnit(12).unit, 'day');
    assert.equal(G.snapUnit(3).unit, 'week');
    assert.equal(G.snapUnit(1).unit, 'month');
});

test('snapSteps has a half-unit dead zone and is symmetric', () => {
    assert.equal(G.snapSteps(4, 28), 0);
    assert.equal(G.snapSteps(15, 28), 1);
    assert.equal(G.snapSteps(-15, 28), -1);
    // at years a single pixel of jitter does nothing
    assert.equal(G.snapSteps(1, 1), 0);
    assert.equal(G.snapSteps(-1, 1), 0);
    assert.equal(G.snapSteps(20, 1), 1);
});

test('shiftBySteps moves by days, weeks, or whole calendar months', () => {
    const d = G.dayOf('2026-01-31');
    assert.equal(G.isoOf(G.shiftBySteps(d, 2, 28)), '2026-02-02');
    assert.equal(G.isoOf(G.shiftBySteps(d, 1, 3)), '2026-02-07');
    assert.equal(G.isoOf(G.shiftBySteps(d, 1, 1)), '2026-02-28');
    assert.equal(G.isoOf(G.shiftBySteps(d, -2, 1)), '2025-11-30');
});

// ----- line editing ----------------------------------------------------

test('setLineDuration rewrites the token the scheduler reads, and only that', () => {
    const cases = [
        ['  Build 3d @dev', 5, '  Build 5d @dev'],
        ['  Print 3d model 2d', 4, '  Print 4d model 2d'],          // the scheduler reads the first
        ['  $GW2 Gateway review 3d !', 1, '  $GW2 Gateway review 1d !'],
        ['  * +2d Build 3d @a', 6, '  * +2d Build 6d @a'],           // the lag is not the duration
        ['  * +2d Build', 6, '  * +2d Build 6d'],
        ['  Design UI {UX} !! "note"', 2, '  Design UI {UX} !! "note" 2d'],
        ['  Spec ~3d/5d 4d', 6, '  Spec ~3d/5d 6d'],                 // effort is not duration
        ['  Plan 2w', 14, '  Plan 2w'],                              // unit kept when it divides
        ['  Plan 2w', 21, '  Plan 3w'],
        ['  Plan 2w', 9, '  Plan 9d'],
        ['  Build @a 5days 0%', 7, '  Build @a 7d 0%'],             // long form, as templates write it
        ['  Build 2weeks', 21, '  Build 3w'],
    ];
    for (const [line, days, expected] of cases) {
        assert.equal(G.setLineDuration(line, days), expected, line);
    }
});

test('setLineStart rewrites the start date and never the deadline', () => {
    assert.equal(G.setLineStart('  Build 3d 2026-01-05', '2026-02-02'), '  Build 3d 2026-02-02');
    assert.equal(G.setLineStart('  Build 3d D2026-03-01', '2026-02-02'), '  Build 3d D2026-03-01 2026-02-02');
    assert.equal(G.setLineStart('  Build D2026-03-01 2026-01-05 3d', '2026-02-02'), '  Build D2026-03-01 2026-02-02 3d');
    assert.equal(G.setLineStart('  Build 3d [levelled @a 2026-01-05]', '2026-02-02'), '  Build 3d [levelled @a 2026-02-02]');
    assert.equal(G.setLineStart('  Design UI', '2026-02-02'), '  Design UI 2026-02-02');
});

// ----- the drag edit, through the real scheduler -------------------------

const PLAN = `---
title: Drag
non-working-days:
  - 2026-01-14
---

Phase
  Spec 3d @a 2026-01-05
  Design UI 2d [depends Spec]
  $GW2 Gateway review 1d !! [depends Design UI]
  * +2d Build 3d
  Design 2d
Other
  Design 4d 2026-01-05
`;

function scheduled(text) {
    return localParse(text).tasks;
}

function dragFor(text, name, index, handle) {
    const tasks = scheduled(text);
    const matches = tasks.filter(t => t.name === name);
    const task = matches[index];
    return {
        uid: task._uid, index: tasks.indexOf(task), handle,
        startDay: G.dayOf(task.start), finishDay: G.dayOf(task.finish),
        milestone: task.duration_days === 0,
        calendar: dragCalendar(text, task._uid),
    };
}

test('right handle: the duration follows the finish, and dependants move with it', () => {
    const drag = dragFor(PLAN, 'Spec', 0, 'right');
    const preview = previewDrag(PLAN, drag, 2, 28, inject);
    assert.ok(preview);
    assert.match(preview.text, /\n {2}Spec 5d @a 2026-01-05\n/);
    const before = scheduled(PLAN), after = preview.result.tasks;
    const ui = i => i.find(t => t.name === 'Design UI');
    assert.ok(G.dayOf(ui(after).start) > G.dayOf(ui(before).start), 'the dependant did not move');
});

test('right handle across a holiday counts working days, not calendar days', () => {
    // Spec runs Mon 5 - Wed 7 Jan; the 14th is a holiday. Dragging the
    // finish on eight days (to Fri 16 Jan) covers 8 working days, not 9, and
    // the scheduler's finish lands where the pointer did.
    const drag = dragFor(PLAN, 'Spec', 0, 'right');
    const edit = planDragEdit(PLAN, drag, 8, 28, inject);
    assert.match(edit.text, /\n {2}Spec 8d @a 2026-01-05\n/);
    const moved = localParse(edit.text).tasks.find(t => t._uid === drag.uid);
    assert.equal(moved.finish, G.isoOf(drag.finishDay + 8));
});

test('left handle keeps the finish and writes start plus duration', () => {
    const text = PLAN.replace('Other\n  Design 4d 2026-01-05', 'Other\n  Design 4d 2026-01-12');
    const drag = dragFor(text, 'Design', 1, 'left');
    const preview = previewDrag(text, drag, 1, 28, inject);
    const moved = preview.result.tasks.find(t => t._uid === drag.uid);
    assert.equal(moved.start, '2026-01-13');
    assert.equal(G.dayOf(moved.finish), drag.finishDay, 'the finish moved');
    assert.match(preview.text, /Design 3d 2026-01-13/);
    assert.equal(preview.blocked, false);
});

test('a drag on a $product, !priority and * +2d line writes to that line', () => {
    const gw = previewDrag(PLAN, dragFor(PLAN, '$GW2 Gateway review', 0, 'right'), 2, 28, inject);
    assert.ok(gw, 'no edit for the $product line');
    // Mon 12 Jan + two days, across the 14 Jan holiday: 2 working days
    assert.match(gw.text, /\$GW2 Gateway review 2d !! \[depends Design UI\]/);
    // the engine names this task '+' (the star-lag prefix is only half
    // supported); it is addressed by _uid, so the name does not matter
    // Build finishes on a Friday: one or two days on is the weekend, which
    // adds no working days, so it takes three to reach Tuesday.
    assert.equal(planDragEdit(PLAN, dragFor(PLAN, '+', 0, 'right'), 1, 28, inject), null);
    const build = previewDrag(PLAN, dragFor(PLAN, '+', 0, 'right'), 3, 28, inject);
    assert.ok(build, 'no edit for the * +2d line');
    assert.match(build.text, /\* \+2d Build 4d/);
    const b = build.result.tasks.find(t => t.name === '+');
    assert.equal(b.duration_days, 4);
});

test('middle drag moves the task; a predecessor blocks moving it earlier', () => {
    const drag = dragFor(PLAN, 'Design UI', 0, 'middle');
    const later = previewDrag(PLAN, drag, 3, 28, inject);
    assert.equal(later.blocked, false);
    const earlier = previewDrag(PLAN, drag, -2, 28, inject);
    assert.equal(earlier.blocked, true);
});

test('a task whose name prefixes another, or is duplicated, is edited on its own line', () => {
    const first = previewDrag(PLAN, dragFor(PLAN, 'Design', 0, 'right'), 1, 28, inject);
    assert.match(first.text, /\n {2}Design 3d\nOther\n {2}Design 4d 2026-01-05\n/);
    assert.match(first.text, /Design UI 2d \[depends Spec\]/);
    const second = previewDrag(PLAN, dragFor(PLAN, 'Design', 1, 'right'), 1, 28, inject);
    assert.match(second.text, /\n {2}Design 2d\nOther\n {2}Design 5d 2026-01-05\n/);
});

test('left handle cannot shrink a task below one working day', () => {
    const drag = dragFor(PLAN, 'Spec', 0, 'left');
    assert.equal(planDragEdit(PLAN, drag, 5, 28, inject), null);
});

test('a drag with no net movement is no edit at all', () => {
    const drag = dragFor(PLAN, 'Spec', 0, 'right');
    assert.equal(planDragEdit(PLAN, drag, 0, 28, inject), null);
});

test('at the years zoom a drag moves by whole months', () => {
    const drag = dragFor(PLAN, 'Spec', 0, 'middle');
    const edit = planDragEdit(PLAN, drag, 1, 1, inject);
    assert.match(edit.text, /Spec 3d @a 2026-02-05/);
});
