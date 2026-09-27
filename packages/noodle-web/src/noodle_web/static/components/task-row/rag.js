/**
 * A task's RAG status as one of the four status tokens.
 *
 * The engine reports RAG as a descriptive status ("On track", "Task
 * overdue"); older plans and some views hold the colour itself. Both map to
 * green, amber, red or blue -- --np-success, --np-warning, --np-danger and
 * --np-info in <np-task-row>. script.js's ragStatusToColour() carries the
 * same table for the views that still paint RAG themselves;
 * tests/test_np_task_row.mjs fails if the two disagree.
 *
 * Its own module, with no DOM, so that test can import it.
 */

export const RAG_COLOURS = Object.freeze({
    'not started': 'green',
    'on track': 'green',
    'ahead of schedule': 'green',
    complete: 'blue',
    'behind schedule': 'amber',
    'task overdue': 'red',
    green: 'green',
    amber: 'amber',
    red: 'red',
});

export function ragColour(rag) {
    return RAG_COLOURS[String(rag || '').trim().toLowerCase()] || '';
}
