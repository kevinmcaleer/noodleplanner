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

## Phase 3: recolouring the rest

The palette decision (#1322) is made: the Bootstrap/Material/Tailwind
literals move onto the warm tokens, and this time a visible change is
allowed. Penpot added two single-valued tokens for it, `--np-on-fill` (white
on a coloured fill, both themes) and `--np-shade` (black, the base for
`color-mix()` scrims and shadows that must not flip). Each slice was captured
before and after, 84 screens x 2 themes, and every changed screen was looked
at.

| # | Slice | Screens changed | What changed, and why |
|---|---|---|---|
| 9 | Ribbon | 82 light, 0 dark | The ribbon's old dark-blue title-bar palette (`#a9c7d4`, `#e3f2fd`, `rgba(2,20,28,…)` …) and the `--np-dark-blue`/`--np-blue` it used become the warm neutrals visual-system.css's ribbon layer already paints with, so the two layers now agree and the 60-line dark ribbon block in dark-mode.css is deleted. Visible: the Project/Programme/Portfolio scope track now shows as a `--np-sunken` pill, and the title-bar separator as a `--np-border` hairline, where both had been white-on-light and invisible. Popover shadows are `--np-floating-shadow`. Dark is unchanged because visual-system.css already won there. |
| 10 | Tables and sheets | 4 (resource sheet and timesheet, both themes) | Indigo summary rows (`#e8eaf6`/`#dde0f3`) become `--np-summary-row(-hover)`, which is what dark already used, so those dark overrides go. The resource sheet's allocated bar is `--np-info` and overlaps `--np-danger`. Timesheet hours and holidays use the warning/danger tint+ink pairs in both themes (dark had its own `#3a3020`/`#e0a020` set, now deleted). White-on-blue header separators left over from the old blue table heads become `--np-hairline`. RAID/budget row hovers are `--np-table-hover` (and RAID's odd rows no longer hover to `--np-paper`). Off-screen changes: "Complete"/blue RAG fills are `--np-info` with `--np-on-info` text (white on it measured 3.9:1); the Up Next chips are tint+ink rather than white on saturated fills. |
| 11 | Status colour: badges, tags, text, bars | 5 (project report both themes, Gantt dark populated and empty, Kanban dark) | Every pastel-fill-plus-saturated-text badge (RAID type/score/status/escalation, lesson impact, benefit status, budget type, stakeholder level, action priority, RAID/MSP sync kinds, stalled, Up Next) becomes the status `*-tint` + `*-ink` pair, which flips with the theme; before, most were light pastel with a mid-tone status colour even in dark, and none had a dark override. On screen: the milestone RAG badges on the project report are now tint+ink like the report RAG badges beside them (were white on bright green, 2.1:1). Purple has no themed pair, so the RAID dependency badge, kanban tag and "mixed" lesson impact use `color-mix()` of `--np-purple` into the surface (fill) and into the ink (text), now scored by check-contrast.mjs (6.3:1 light, 5.3:1 dark). Dark Gantt bars are `--np-green`; dark kanban duration chips use the light rule's info tint (their `#1a2e4a` override is deleted). Old blue hovers on accent buttons (`#0d7096`/`#0d7aa3`) are `--np-accent-hover`. The dark read-only version banner is the danger tint+ink pair, because white on the dark danger fill is 3.6:1. Wizard completed-step numbers are `--np-on-success` on `--np-success` (4.6:1 / 8.9:1, newly scored). |
