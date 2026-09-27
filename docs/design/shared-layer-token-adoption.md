# Shared layer onto tokens: evidence (#1323)

`components.css` and `dark-mode.css` moved onto tokens by
[`scripts/adopt-exact-colour-tokens.mjs`](../../scripts/adopt-exact-colour-tokens.mjs),
which only makes substitutions that are exact in **both** themes (its header
says what that allows). The palette for everything else is #1322's decision;
the literals left behind are listed in the #1323 hand-off, not here, because
that list goes stale the moment the decision lands.

## How each slice was checked

Every slice was captured before and after, in both themes, and compared:

- **Screens.** `scripts/capture_screen_audit.py` (84 screens per theme: every
  view populated and empty, plus the six modals) and
  `scripts/compare_screens.py --tolerance 0 --threshold 0`, i.e. any pixel at
  all. Two captures of the *same* CSS differ in two places, and those are the
  only differences any slice produced:
  - the version stamp in the status bar (`v1.0.0+<sha>`), which changes with
    the working tree, on every screen;
  - anti-aliasing of the rounded image corners on the Templates modal's cards,
    1-5 levels per channel, in both themes (it moves in light too, where no
    slice changed anything that modal draws).
- **Computed style.** `getComputedStyle` of every element in the document
  (~9,000 per screen, hidden ones included) plus `::before`, `::after` and
  `::placeholder`, for every colour-bearing property -- colour, background,
  the four border colours, outline, box- and text-shadow, fill, stroke, caret,
  text-decoration, opacity, filter -- on every screen in both themes. And each
  touched selector's elements with `:hover`, `:focus`, `:focus-visible`,
  `:active` and `:focus-within` forced through the DevTools protocol, since a
  screenshot cannot show those. Two things differ between two captures of the
  same CSS and are ignored: the confetti `spawnConfetti()` scatters with a
  random inline colour, and `outline-color` read mid-transition under a forced
  focus state (`outline-style` is `none` there, so it does not paint).

A slice passes when nothing else differs.

## Slices

| # | Slice | Changes | Screens (2 x 84) | Computed style | raw-colour |
|---|---|---|---|---|---|
| 1 | Panels, cards and popups | 1 light literal and 1 dark literal to `--np-shadow`; 10 dark declarations deleted (3 whole rules) | identical | identical | 715 -> 713 |
| 2 | View wrappers and boards | 11 dark declarations deleted (2 whole rules): Kanban board/column/splitter, Gantt, Tasks, stakeholder grid, RAID, Actions, Budget and Timesheet wrappers | identical | identical (final-state capture) | 713 -> 713 |
| 3 | Timeline and milestone labels | 3 dark rules deleted whole (`.milestone-date`, `.timeline-date-label`, `.timeline-scale-label`) | identical (plus 6 px of subpixel text AA in the *light* editor on project-report, which a dark-only change cannot reach) | identical (final-state capture) | 713 -> 713 |
| 4 | NoodleSheet | 5 dark declarations deleted (3 whole rules): column letter/name, even-row stripe, context menu background and shadow | identical | identical (final-state capture) | 713 -> 713 |
| 5 | Portfolio | 19 dark declarations deleted (8 whole rules): container, header, project card, and the Status/Resources/Timeline/Actions/Risks/Look-ahead section headers, their `h2`s and table wrappers, `.timeline-project-label` | identical | identical (final-state capture) | 713 -> 713 |
| 6 | Version read-only banner | 2 dark declarations deleted (1 whole rule) that repeated status-bar.css's literals: the banner's `color: #fff`, the overlay tint `rgba(211, 47, 47, 0.1)` | identical | identical | 713 -> 711 |

Slices 2-5 were screen-captured on their own; the computed-style capture was
taken after slice 1 and again after slice 6, so it covers 2-5 cumulatively.
Final state against the base, both themes: 1,553,842 element-states compared,
none differ outside the two noise sources above.

**Totals after moves 1-3.** raw-colour findings: `components.css` 268 -> 267,
`dark-mode.css` 139 -> 136, all files 715 -> 711. 50 declarations deleted from
`dark-mode.css`, 20 of its rules removed whole.

## Move 4: colours that never paint

visual-system.css's `:root body .x` layer restyled the ribbon, the calendar,
the table heads and the rest on top of the old rules and left those rules in
place, still carrying colours nobody can see. Move 4 deletes a colour
declaration only on a **static** proof that it never wins, not because it was
never seen on a captured screen: for every selector of its rule and every
longhand it sets, another declaration

- beats it in the cascade: `!important` over normal, higher specificity, or
  equal specificity and later on *every* page that loads the file
  (`collab_join.html` loads a shorter list in a different order);
- is unconditional, or under the same `@media`;
- matches every element it matches, in every state: the winner's subject
  compound is a subset of the loser's (`.x` covers `.x:hover`;
  `:is(thead, th)` covers `th`), its ancestors are implied in order by the
  loser's, and `:root body` counts as always true only for a subject named by a
  class the app never puts on `<html>`/`<body>`.

`node scripts/adopt-exact-colour-tokens.mjs --dry-run --verbose` prints the
winner behind each one. Where only a border shorthand's *colour* loses (the
winner sets `border-color`, the width and style still paint), just the literal
is dropped: `1px solid #d8e1e5` becomes `1px solid`, and the colour longhand,
now `currentColor`, loses to the same winner.

One test changed with it: `tests/test_dark_mode.py` asserted that
`[data-theme="dark"] .ribbon-titlebar` exists in dark-mode.css. That rule was
one of the dead ones (`:root body .ribbon-titlebar` outranks it with a surface
token that swaps by itself), so the test now asserts the token instead.

**Proof.** Before = the branch after slice 6, after = all of move 4. Screens,
84 x 2 themes: identical apart from the version stamp and the Templates
modal's corner anti-aliasing. Computed style, re-run with transitions and
animations disabled so forced states read settled values: two captures of the
same CSS now differ in nothing but the confetti, and before vs after is
1,554,380 element-states compared, **0 differ** -- including the 43 touched
selectors (29 had elements on the page at the time) in `:hover`, `:focus`,
`:focus-visible`, `:active` and `:focus-within`.

| # | Slice | Changes | Screens (2 x 84) | Computed style | raw-colour |
|---|---|---|---|---|---|
| 7 | Move 4: ribbon | 24: 19 declarations deleted, 5 border shorthands lose their colour; 9 rules removed whole | identical | identical | 711 -> 687 |
| 8 | Move 4: tables, calendar, badges, detail pane, NoodleSheet selection | 27: 24 deleted, 3 border shorthands lose their colour; 9 rules removed whole | identical | identical | 687 -> 663 |

**Totals after move 4.** raw-colour findings: `components.css` 267 -> 231,
`dark-mode.css` 136 -> 124, all files 711 -> 663.
