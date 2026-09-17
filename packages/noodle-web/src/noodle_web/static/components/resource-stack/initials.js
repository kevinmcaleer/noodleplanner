/**
 * The app's one initials algorithm (#1246, under #1199).
 *
 * Its own module, rather than an export from np-resource-stack.js, so it can be
 * imported without a DOM: that component evaluates `class ... extends
 * HTMLElement` at module scope, which is a ReferenceError in plain node, and
 * this repo has no jsdom. tests/test_np_resource_stack.mjs compares this
 * against whiteboard-notes.js's wbGetInitials() run for real, which is only
 * possible because this file imports nothing.
 *
 * There were four implementations before this: wbGetInitials()
 * (whiteboard-notes.js), tpGetInitials() (task-peek.js, which delegates to the
 * first when it is loaded and duplicates the body when it is not),
 * KanbanBoard.getInitials() (kanban.js) and getResourceInitials()
 * (script.js). The two pilot components sidestepped the question entirely by
 * taking pre-computed initials as a string attribute, and when <np-note> grew
 * a real copy it drifted immediately: first-and-second word rather than
 * first-and-last, so "Mary Jane Watson" came out MJ here and MW on the board.
 */
export function initialsFor(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return '?';
    const words = trimmed.split(/\s+/);
    // First and *last*, not first and second.
    if (words.length >= 2) {
        return (words[0][0] + words[words.length - 1][0]).toUpperCase();
    }
    if (words[0].length >= 2) return words[0].substring(0, 2).toUpperCase();
    return trimmed.substring(0, 1).toUpperCase();
}
