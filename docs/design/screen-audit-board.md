# The screen audit board

The visual side of [#1196](https://github.com/kevinmcaleer/noodleplanner/issues/1196):
every screen the app can render, laid out side by side, with the remaining
design drift annotated on each one.

Everything here is generated. Nothing is drawn by hand:

```sh
npm run design:screens   # captures the screens and writes board.svg
npm run design:board     # annotates the board with per-screen drift
```

Both need a NoodlePlanner running (default `http://localhost:8007`; pass
`--base-url` otherwise). The output lands in `penpot/screen-audit/`, which is
gitignored — 173 files of PNG is not something to keep in version control when
one command regenerates it.

## What gets captured

**84 screens**, in each theme:

| | Count | What |
|---|---|---|
| Populated views | 39 | Every project and portfolio view, against a sample plan with tasks, RAID entries, a whiteboard and back matter |
| Empty states | 39 | The same views against a plan with front matter and no tasks |
| Modals | 6 | Keyboard shortcuts, AI settings, AI chat, templates, the baseline dialog, task detail |

The empty states and modals are there because #1196 asks for them, and because
they are where drift hides. An empty state is written once and rarely looked at
again; a modal is the one surface a designer reviewing a board of screenshots
never sees.

The six modals are the ones that actually open from a single global call with
nothing else set up — checked against the running app rather than read off the
template. Of ten candidates, `excelWizardOverlay` opens nothing visible without
an upload in progress, and three others have no global opener at all. The
capture reports each skip and why rather than quietly producing 3 modals and
calling it 6.

Each capture is hashed. Two screens that come back byte-identical did not both
render — a view switch that fails silently leaves the previous screen up, and
the first version of this script captured the same screen nine times and
reported 39/39.

## What the badges mean

Each tile carries a pill: **`N own · M total`**.

- **total** — findings from `lint-design-system.mjs` whose selector matches
  something visible on that screen.
- **own** — of those, the ones rendering on three screens or fewer.

`own` is the number worth reading. A raw per-screen count is dominated by the
chrome every screen shows, so every view lands between 48 and 82 and the board
tells you nothing. Filtering to what is distinctive separates `gantt` (20 own)
and `calendar` (18) from `guide` and `Lessons` (0 each, i.e. nothing but shared
chrome). Amber pill = something here to act on; sage = shared chrome only.

Attribution is **measured, not inferred**. The first version mapped a view to a
stylesheet by name — `gantt` to `views/gantt.css` — which sounds reasonable and
is wrong for 34 of the 39 views: there is no `tasks.css`, no `raid.css`, no
`calendar.css`, because most views are painted by the shared `components.css`.
It silently badged five screens and left the rest blank. What replaced it loads
each view in a real browser and asks `document.querySelector` which of the
linter's 468 distinct finding-selectors match something visible there.

The summary panel at the foot of the board carries the inventory totals from
`token-audit-data.json`, so the per-tile numbers have a denominator on the same
board rather than in another document.

## Taking it into Penpot

**File → Import**, pointing at `penpot/screen-audit/board.annotated.svg`. Keep
the PNGs alongside it — the board references them by relative filename, so
moving the SVG on its own gives you an empty grid.

`board.dark.annotated.svg` is the same board in dark mode. Import both: a good
half of what this epic found only shows up in one theme, including the
unreadable "Up Next" table that was dark text on a dark ground.

For the tokens, **Design → Tokens → Import** and the five files in
`docs/design/tokens/` (`core.json`, `color-light.json`, `color-dark.json`,
`$themes.json`, `$metadata.json`). They are W3C Design Tokens-typed JSON in the
Tokens Studio multi-set format Penpot reads natively.

Those files are generated from `visual-system.css` by `npm run audit:tokens`,
and `tests/test_design_token_export.py` fails if they drift from it. That test
exists because they had drifted: the export carried no `warning` token at all,
so an import before it would have handed a designer a palette missing the
semantic ramp the epic had just settled.

## Recording the board

Once the project exists, put its URL here:

<!-- PENPOT-BOARD-URL -->
**Penpot board:** _not yet created — needs a Penpot account._
<!-- /PENPOT-BOARD-URL -->

This is the one part of #1196 that cannot be generated. Everything it imports
is in the repo or one command away; creating the project itself needs an
account.
