/**
 * Layout facts <np-menu> needs that live in CSS.
 *
 * `swatchColumns` mirrors `.wb-note-menu-grid`'s
 * `grid-template-columns: repeat(6, ...)` in views/whiteboard.css. Arrow-key
 * navigation of a grid needs to know its width, and reading it back out of
 * `getComputedStyle` per keystroke is both slower and harder to follow than
 * saying so once -- but it does mean the two have to stay in step, which is
 * why it is here with a comment rather than inline as a bare `6`.
 */
export const MENU_LAYOUT = {
    swatchColumns: 6,
};
