/**
 * The task details form, the inspector and the Up Next widget must agree on a
 * task's RAG status. The widget (and the task table) read the scheduling
 * engine's calculateRagStatus, which counts whole days; the form and the
 * inspector used to compare new Date('YYYY-MM-DD') (UTC midnight) against a
 * local-midnight "today", so in any non-UTC timezone a task could read
 * "On Track" in the form while Up Next showed it amber (#1472).
 *
 * The form functions are classic-script top-level declarations in
 * static/script.js, lifted into a vm sandbox as tests/test_baseline_dialog.mjs
 * does. The clock is pinned and each timezone is swept, so the result does not
 * depend on where or when CI runs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const scriptSrc = readFileSync(join(staticDir, 'script.js'), 'utf8');
const { calculateRagStatus } = await import(join(staticDir, 'engine', 'scheduler.js'));
const { dayOf, isoOf } = await import(join(staticDir, 'engine', 'date-math.js'));

function extract(name) {
  const start = scriptSrc.indexOf(`\nfunction ${name}(`);
  assert.notEqual(start, -1, `${name} not found in script.js`);
  const end = scriptSrc.indexOf('\n}\n', start);
  return scriptSrc.slice(start, end + 3);
}

/** A sandbox holding the form's and the inspector's functions, with a movable clock. */
function makeForm() {
  const clock = { now: new Date() };
  class FakeDate extends Date {
    constructor(...args) { args.length ? super(...args) : super(clock.now); }
    static now() { return clock.now.getTime(); }
  }
  const fields = {
    taskPercent: { value: '' },
    taskStartDate: { value: '' },
    taskFinishDate: { value: '' },
    taskDeadline: { value: '' },
  };
  const ragDisplay = { style: {} };
  const sandbox = {
    Date: FakeDate,
    parseInt,
    Math,
    String,
    Number,
    document: {
      getElementById: (id) => (id === 'ragDisplay' ? ragDisplay : fields[id] || null),
    },
    formatInspectorDate: (s) => s,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    ['ragDayDate', 'ragToday', 'updateRagDisplay', 'calculateInspectorRag'].map(extract).join('\n'),
    sandbox,
  );
  return (now, percent, start, finish) => {
    clock.now = now;
    fields.taskPercent.value = String(percent);
    fields.taskStartDate.value = start;
    fields.taskFinishDate.value = finish;
    sandbox.updateRagDisplay();
    const inspector = sandbox.calculateInspectorRag({ percent, startDate: start, finishDate: finish, deadline: '' });
    return { form: ragDisplay.textContent, inspector: inspector.status };
  };
}

for (const tz of ['UTC', 'Europe/London', 'America/New_York', 'Asia/Tokyo', 'Pacific/Auckland']) {
  test(`form, inspector and engine agree on RAG in ${tz}`, () => {
    process.env.TZ = tz;
    const formRags = makeForm();
    // Just after and just before local midnight: the worst cases for a
    // UTC-vs-local comparison.
    for (const now of [new Date(2026, 5, 10, 0, 30), new Date(2026, 5, 10, 23, 30)]) {
      const today = dayOf(now);
      for (let startOffset = -12; startOffset <= 3; startOffset++) {
        for (let length = 1; length <= 14; length++) {
          for (let percent = 1; percent < 100; percent++) {
            const start = today + startOffset;
            const finish = start + length;
            const engine = calculateRagStatus({ start, finish, percent }, today);
            const { form, inspector } = formRags(now, percent, isoOf(start), isoOf(finish));
            if (engine === 'Behind Schedule' || engine === 'On Track' || engine === 'Not Started' || engine === 'Ahead of Schedule') {
              assert.equal(form, engine, `form: start ${startOffset}d, ${length}d long, ${percent}%`);
            }
            // The inspector additionally reports a task past its finish
            // date as overdue, so only the shared on-track/behind split
            // is compared where the task has not finished yet.
            if (startOffset + length >= 0 && (engine === 'Behind Schedule' || engine === 'On Track')) {
              assert.equal(inspector, engine, `inspector: start ${startOffset}d, ${length}d long, ${percent}%`);
            }
          }
        }
      }
    }
  });
}
