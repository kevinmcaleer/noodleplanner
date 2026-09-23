/**
 * The Gantt's drag-to-reschedule edit, computed by the same engine that
 * schedules the plan (#787).
 *
 * A drag never moves a bar by pixels and hopes the scheduler agrees. Each
 * step of the drag is turned into the edit the plan would receive -- a new
 * duration, a new start date, or both -- and that edited plan is run
 * through `localParse`, the scheduler the page already uses. The preview a
 * user sees mid-drag is therefore the schedule they get on release, with
 * dependants, summary roll-ups, working days, holidays and resource
 * calendars all honoured, and no snap-back.
 *
 * Handles:
 *   right  -- the finish moves; the duration becomes the working days from
 *             the (unchanged) start to the new finish.
 *   left   -- the start moves and the finish stays put; the line gets the
 *             new start date and the working days between the two.
 *   middle -- the whole task moves; the line gets the new start date and
 *             keeps its duration. Milestones only ever move.
 *
 * Writing a start date is how a plan pins a task: the scheduler treats it
 * as "start no earlier than", so a task with predecessors can be dragged
 * later but not earlier than its dependencies allow. The preview shows
 * exactly that -- a blocked drag does not move.
 *
 * The line is found through `NoodlePlanModel` by the task's `_uid`, never by
 * matching its name (#747), and rewritten with `GanttScale`'s token-aware
 * editors. Both are classic scripts on the page; tests inject them.
 */

import { localParse, parseCalendar, planBody } from "./local-parse.js";
import { buildTasks, calendarOrHolidaysForTask } from "./scheduler.js";
import { activeCalendar, resolvedResourceCalendars } from "./calendar.js";
import { countWorkingDays, getNextWorkingDay } from "./date-math.js";

function deps(injected = {}) {
  const root = typeof globalThis !== "undefined" ? globalThis : {};
  return {
    PlanModel: injected.PlanModel || (root.NoodlePlanModel && root.NoodlePlanModel.PlanModel),
    GanttScale: injected.GanttScale || root.GanttScale,
  };
}

/**
 * The working calendar the scheduler uses for the task with `_uid === uid`:
 * the project calendar or holidays, plus the task's own resources'
 * non-working days and resource calendar.
 */
export function dragCalendar(planText, uid) {
  const text = String(planText || "");
  const tasks = buildTasks(planBody(text));
  const task = tasks.find((t) => t._uid === uid) || {};
  const { holidays, resourceNonWorkingDays } = parseCalendar(text);
  return calendarOrHolidaysForTask(
    task, holidays, resourceNonWorkingDays,
    activeCalendar(text), resolvedResourceCalendars(text),
  );
}

/**
 * The plan text after dragging `drag.handle` by `steps` snap units at
 * `pixelsPerDay`, or null when the drag changes nothing or is not possible
 * (the task cannot be found, or the bar would shrink below one working day).
 *
 * `drag` = { uid, index, handle, startDay, finishDay, milestone, calendar }.
 * Day numbers are the task's *scheduled* dates (finish exclusive).
 */
export function planDragEdit(planText, drag, steps, pixelsPerDay, injected) {
  if (!steps) return null;
  const { PlanModel, GanttScale } = deps(injected);
  if (!PlanModel || !GanttScale) return null;

  const model = new PlanModel(planText);
  const node = drag.uid !== undefined && drag.uid !== null
    ? model.findById(drag.uid)
    : model.taskAt(drag.index);
  if (!node) return null;

  const calendar = drag.calendar;
  const shift = (day) => GanttScale.shiftBySteps(day, steps, pixelsPerDay);
  const workingStart = (day) => getNextWorkingDay(day, calendar);
  let updater;
  let expected;

  if (drag.handle === "right" && !drag.milestone) {
    const newFinish = shift(drag.finishDay);
    const duration = countWorkingDays(drag.startDay, newFinish, calendar);
    if (duration < 1) return null;
    updater = (line) => GanttScale.setLineDuration(line, duration);
    expected = { start: drag.startDay, duration };
  } else if (drag.handle === "left" && !drag.milestone) {
    const newStart = workingStart(shift(drag.startDay));
    const duration = countWorkingDays(newStart, drag.finishDay, calendar);
    if (duration < 1) return null;
    updater = (line) => GanttScale.setLineDuration(
      GanttScale.setLineStart(line, GanttScale.isoOf(newStart)), duration);
    expected = { start: newStart, duration };
  } else {
    const newStart = drag.milestone ? shift(drag.startDay) : workingStart(shift(drag.startDay));
    updater = (line) => GanttScale.setLineStart(line, GanttScale.isoOf(newStart));
    expected = { start: newStart };
  }

  if (!model.updateLine(node, updater)) return null;
  const text = model.serialize();
  if (text === planText) return null;
  return { text, expected };
}

/**
 * `planDragEdit` plus the schedule it produces. `blocked` is true when the
 * scheduler would not put the dragged task where the drag asked -- a
 * predecessor holds it later -- which callers use to refuse a left-handle
 * resize that would otherwise grow the bar at the far end.
 */
export function previewDrag(planText, drag, steps, pixelsPerDay, injected) {
  const edit = planDragEdit(planText, drag, steps, pixelsPerDay, injected);
  if (!edit) return null;
  const result = localParse(edit.text);
  if (!result.success) return null;
  const tasks = result.tasks || [];
  const moved = tasks.find((t) => t._uid === drag.uid) || tasks[drag.index];
  const { GanttScale } = deps(injected);
  const blocked = Boolean(moved && GanttScale && edit.expected.start !== undefined &&
    GanttScale.dayOf(moved.start) !== edit.expected.start);
  return { text: edit.text, result, blocked };
}
