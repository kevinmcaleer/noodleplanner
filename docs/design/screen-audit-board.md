# The screen audit board

The visual side of [#1196](https://github.com/kevinmcaleer/noodleplanner/issues/1196):
every screen the app can render, laid out side by side, with the remaining
design drift annotated on each one.

Everything here is generated. Nothing is drawn by hand:

```sh
npm run design:screens   # captures the screens and writes board.svg
npm run design:board     # annotates it, and writes the standalone import file
```

Both need a NoodlePlanner running (default `http://localhost:8007`; pass
`--base-url` otherwise). The output lands in `penpot/screen-audit/`, which is
gitignored — 170-odd PNGs and two 8 MB SVGs are not something to keep in
version control when one command regenerates them.

Both also need the CDN, because the app loads Bootstrap, Bootstrap Icons and
its webfonts from `cdn.jsdelivr.net` and Google Fonts. Screens captured without
them come out in fallback fonts and look plausible, so both scripts now exit
non-zero and list the URLs whenever a CDN request fails. On a network that
blocks jsDelivr but not the npm registry, `--npm-mirror <dir>` (or
`NOODLE_NPM_MIRROR`) serves those files from unpacked `npm pack` tarballs; the
docstring of `scripts/capture_screen_audit.py` has the four-line setup.

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

**File → Import**, pointing at `penpot/screen-audit/board.standalone.svg`.

Use the `.standalone.svg`, not the `.annotated.svg`. The annotated board
references its 84 PNGs by relative filename, and a Penpot import takes a
*file*, not a folder — so importing it gives you a grid of broken-image
placeholders. That is not a guess: rendering the annotated board with the PNGs
moved away produces exactly that, which is how the mistake was found after this
page had already been written recommending it.

The standalone board carries every screen inline as a data: URI. It is ~8 MB
per theme. That is comfortably inside Penpot's own limits — `config.clj` puts
`media-max-file-size` at 30 MiB and `http.clj` puts `max-body-size` at 350 MiB
by default — so the size is not something to work around. Checked against the
source rather than assumed, because "it is only 8 MB" is the kind of thing that
turns out to be 2 MB over a limit at the moment someone is relying on it.

The images are downscaled on the way in to the 800×500 the board draws them at,
so it is not carrying four times the pixels it can show. They stay PNG rather
than JPEG: this is a board for judging spacing and colour drift, and JPEG
artefacts around small UI text are exactly the wrong thing to introduce into
that.

`board.dark.standalone.svg` is the same board in dark mode. Import both: a good
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
