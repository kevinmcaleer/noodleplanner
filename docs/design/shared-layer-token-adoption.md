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
