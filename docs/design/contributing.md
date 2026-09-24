# Working on NoodlePlanner's UI

What CI checks, and how to decide between a token, a component and a one-off.
For the *why* behind these rules — the migration's principles, vocabulary,
and current status against its plan — see
[`design-system.md`](design-system.md).

Run the gates before you push — they take seconds and need no browser:

```sh
npm run lint:design             # hardcoded colours, off-scale spacing, focus, token placement
npm run check:contrast          # WCAG AA across every token pairing the app renders
npm run design:tokens -- --check  # the CSS tokens match Penpot's export
```

Or `ci/run.sh design`, which is what CI runs.

## The rules

### 1. Tokens are changed in Penpot, not in `visual-system.css`

Penpot is the source of truth for the design tokens (#1318). The
[Penpot design file](screen-audit-board.md#recording-the-board) holds them as
the `core`, `color-light` and `color-dark` sets, `docs/design/tokens/*.json` is
its export, and the token block at the top of `visual-system.css`, between the
`BEGIN PENPOT TOKENS` and `END PENPOT TOKENS` comments, is generated from that
export. To change, add or remove a token:

1. Change it in Penpot. A token's description is the comment the generator
   writes above it, so put the reasoning there.
2. Export the token sets (Tokens → Export, multiple files) over
   `docs/design/tokens/`.
3. Run `npm run design:tokens`, then the contrast check, and commit the JSON
   and the CSS together.

Never edit the generated block, and never redeclare one of its tokens elsewhere
in the file to override it. `npm run design:tokens -- --check` fails on both,
and it runs in the `design` CI job and in `tests/test_design_tokens.py`.

The generator translates rather than copies, because Penpot does not store a
token the way the CSS does: font sizes are px in Penpot and em in the CSS, font
families are a family and a fallback rather than the full stack, a reference
such as `{accent-ink}` becomes `var(--np-accent-ink)`. The header of
`scripts/design-tokens.mjs` lists the rules, and its `FONT_STACKS` and
`CSS_VALUES` tables are the only CSS-side facts about a Penpot token kept in
the repository.

**Code-owned tokens** are the exception: the three `*-gradient` tokens and the
four `--np-anim-*` motion tokens. Penpot has no token type for a gradient, a
duration or an easing, so they are hand-written in `visual-system.css` below the
generated block and are changed there. `CODE_OWNED` in
`scripts/design-tokens.mjs` is the list of them.

### 2. Tokens live in `visual-system.css`, nowhere else

Any `--np-*` declared on `:root` or `[data-theme="dark"]` in another
stylesheet is a violation.

This is not tidiness. The app previously had **three** token layers defining
the same names with different values, resolved only by stylesheet load order,
and `dark-mode.css` — the file whose name says "this is where dark mode lives"
— was dead code for every token it appeared to own. See
[`token-audit.md`](token-audit.md).

A custom property scoped to a component's own selector is fine and normal.
It is only the global scope that is reserved.

### 3. Colour comes from a token

`color`, `background`, `border-color`, `box-shadow` and friends should
reference a token. [`tokens.md`](tokens.md) is the reference.

Four categories are allowlisted in `scripts/lint-design-system.mjs`, each for a
reason rather than for convenience:

- **The editor's syntax theme.** ~30 rules of VS Code-derived colours on a
  permanently dark editor surface. Worth tokenising as a set; not the UI
  palette.
- **Chart series colours.** `--evm-line-*` and friends are data encodings
  handed to a canvas API, not surfaces.
- **`visual-system.css` itself.** Literals are what a token layer is made of.
- **RAG and traffic-light hues.** Red/amber/green *is* the meaning of the
  element, and which reds count as red is a product decision.

One token family bends rule 2 and says so in place: the whiteboard note
palette, `--np-note-*`. The ten swatches are declared here *and* as
`WB_NOTE_PASTEL_COLOURS` in `whiteboard-notes.js`, because a note's colour is
written into the plan's `Theme:` front matter as a literal by code that cannot
read a stylesheet, while `check:contrast` can only score a value it finds in
the token file. `tests/test_note_ink.mjs` asserts the two lists are identical,
so the duplication cannot drift. Do not copy the pattern without the test.

If your case genuinely belongs outside the system, add an entry to `ALLOW`
with the reason. Adding one is a reviewable act; a lint suppression comment
would not be.

### 4. Spacing comes from the scale

Use `--np-space-0` through `--np-space-64`. `margin`, `padding` and `gap` in
pixels **off the 4px grid** are violations.

The rule is the grid, not the eleven named steps. Values on the grid but
outside `--np-space-*` are allowed, because plenty of them are load-bearing:
`padding-bottom: 36px` matches the fixed status bar's height, and
`padding-right: 44px` is clearance for the icon inside a search input. Prefer a
named step; reach past it when you are measuring against something real.

`0`, `1px` and `2px` are finer than the grid and fine. `em`, `rem` and
percentage spacing are not checked — those track their container by design.

The app used to carry two interleaved half-scales, 4/8/12/16 and 5/10/15/25/30,
from different authors. #1194 collapsed the second onto the first (nearest
multiple of 4, ties up), so there is now one. Don't reintroduce the other.

### 5. Removing a focus outline means replacing it

`outline: none` in a `:focus` rule needs something visible in the same rule.
Usually:

```css
.thing:focus-visible {
    outline: none;
    box-shadow: var(--np-focus-ring);
}
```

Most components need nothing at all: `visual-system.css` rings every natively
focusable element and every interactive ARIA role already. Write a focus rule
only when a component needs something different.

`outline: none` on a **resting** state is fine and is not flagged. So is
`:focus:not(:focus-visible)`, which is the correct way to suppress a ring for a
pointer click while keeping it for the keyboard.

### 6. Type comes from a token

There are three families: `--np-font-ui` for interface text,
`--np-font-heading` for titles, and `--np-font-data` for anything monospaced
(IDs, dates, code, the plan editor). `font-family` names one of them, or
defers to the cascade with `inherit`. The `raw-font-family` rule flags
anything else, in stylesheets. Icon fonts are exempt because they are glyph
sets, not typefaces.

This rule came late and was needed. A walk of all 39 views, at desktop and
mobile width, counted about 3,300 rendered text elements in Courier New,
`ui-monospace` or the macOS system stack instead of the approved faces. They came from 19 hand-written stacks:
every author who wanted monospace had reached for the one they knew. All 19
were moved onto the tokens and the rule has no baseline, so a new one fails CI.

The linter only sees stylesheets. The same holds for a `style=""` in a
template or a `.style.fontFamily` in JS: use `var(--np-font-data)`, which
works in both. The one place a token cannot go is a canvas `ctx.font` string,
because canvas does not resolve custom properties. `mindmap.js` measures node
text on a canvas and sizes its inline editor to match. Its font stays a literal
until the measurement reads the resolved token, and changing one without the
other would mis-size the editor.

## The ratchet

There are ~1,950 pre-existing violations, recorded per finding in
`ci/design-system-baseline.json`. The linter fails only when a count goes up or
a new finding appears.

A linter that failed on all 1,950 on day one would be switched off within a
week, and a warn-only one that cannot fail gets read once and ignored. This way
existing debt is tolerated, adding to it is blocked, and paying it down is
rewarded — clean up a file and the linter tells you to lower the baseline:

```sh
node scripts/lint-design-system.mjs --update-baseline
```

Re-baselining is normal after a refactor that moves code between files. It is
not a way to sneak a violation past review: the baseline is committed, so a
number going up shows in the diff.

To see everything one rule is currently unhappy about:

```sh
node scripts/lint-design-system.mjs --list raw-colour
```

## Contrast has no baseline

`check:contrast` is absolute. It scores 71 pairings the app actually renders —
text on each surface, labels on the accent, status text on its tint, control
borders, the focus ring, the whiteboard note's ink on each of its ten pastels —
in both themes, and all 142 pass.

There is no legitimate version of body text at 4:1 or a focus ring at 2:1, so
there is nothing to ratchet. If you change a palette value and this fails, the
value is wrong.

Three distinctions the checker encodes, all worth knowing:

- **`--np-border-control` vs `--np-border-strong`.** WCAG 2.2 SC 1.4.11 wants
  3:1 for the boundary of a UI component, and nothing for decorative
  separators. Anything the user has to find the edge of — inputs, selects,
  secondary buttons — uses `--np-border-control`. Row hairlines and panel edges
  use `--np-border`/`--np-border-strong` and are not checked.
- **The focus ring is two-layer.** An inner halo in `--np-paper`, then the
  ring. No single colour clears 3:1 against both a dark page and a marigold
  button, so the halo means the ring always meets `--np-paper` whatever is
  underneath.
- **A translucent foreground is composited before it is scored.** The checker
  paints `#rrggbbaa` and `rgba()` onto the background first, which is what the
  browser does. This is the only way a de-emphasis level can be checked at all:
  the whiteboard note's `--np-note-ink-muted` is its ink at 70% and measures
  4.90:1 on the worst swatch, where the raw value would have scored 9.69:1 and
  told you nothing. If you dim text with `opacity`, nothing here can see it —
  which is exactly how five sub-AA values survived on the note until #1250.

## Adding a component

Add it to `static/component-gallery.js` and it appears at `/components` in both
themes, and in Storybook. One spec, two consumers — two hand-maintained
galleries drift, and the second one to drift is the one nobody notices.

If your component is worth a story, it is worth an entry there. If it has a
known problem, put it in the entry's `issues` list rather than leaving the
gallery to imply it is finished.

A new **variant** needs nothing else. A new **section** also needs one line in
`.storybook/stories/components.stories.js`, because Storybook's CSF reads
static named exports and cannot generate a story in a loop.
`tests/test_storybook_stories.py` fails until it is there.

```sh
npm run storybook          # dev server on :6006
npm run build-storybook    # static build
ci/run.sh storybook        # what CI runs: build, then render every story
```

The **States** story puts each base control (buttons, `<np-button>`, text
input, select, `<np-checkbox>`) in a row and each interactive state in a
column: default, hover, keyboard focus and disabled. `:hover` and
`:focus-visible` cannot be triggered from a script, so
`storybook-addon-pseudo-states` forces them by rewriting the app's own
stylesheets. The Hover column shows the real `:hover` rule, not a copy of it.
Loading and error are separate stories, because the app has a loading
indicator and a few error messages rather than a loading or error state *per
control*. There is no invalid-field style anywhere in the app, so none is
shown.

CI's `storybook` job builds Storybook and then loads every story from the
build in both themes (`scripts/check_storybook.py`). A build on its own
bundles the stories without running them, so a story that throws at render
time would pass. The job fails on that, on any uncaught exception, and on a
row of the States story whose focused state looks the same as its resting one.
That last check catches both the addon silently no longer forcing states and a
control losing its focus ring.

To add a story for a web component, put `<name>.stories.js` next to it under
`static/components/`. `.storybook/main.mjs` picks it up from there.

## Reviewing a change

`.github/pull_request_template.md` carries a design-system section: tokens not
literals, both gates green, legible in both themes, focus kept visible, and new
components added to the gallery. It asks for what CI cannot check. The linter
sees a hardcoded colour but not a token used in the wrong role, and the
contrast check scores token pairings, not what a particular new element ends
up sitting on.

## Where things are

| | |
|---|---|
| Design-system charter (why, vocabulary, status) | [`design-system.md`](design-system.md) |
| Tokens (source) | The Penpot design file, exported to `docs/design/tokens/` |
| Tokens (generated CSS) | `packages/noodle-web/src/noodle_web/static/visual-system.css` |
| Token generator | `scripts/design-tokens.mjs` (`npm run design:tokens`) |
| Token reference | [`tokens.md`](tokens.md) |
| What the audit found | [`token-audit.md`](token-audit.md) |
| Every screen, its components, and the build-order tally | [`noodleplanner-ui-inventory.md`](noodleplanner-ui-inventory.md) |
| What is left, in order | [`standardisation-backlog.md`](standardisation-backlog.md) |
| Design-tool handoff | [`consolidation-and-handoff.md`](consolidation-and-handoff.md) |
| Gallery spec | `static/component-gallery.js` |
| Linter | `scripts/lint-design-system.mjs` |
| Contrast check | `scripts/check-contrast.mjs` |
| CI jobs | `ci/jobs/design.sh`, `ci/jobs/storybook.sh` |
| PR review checklist | `.github/pull_request_template.md` |
| Storybook | `.storybook/` |
| Screen-audit capture | `scripts/capture_screen_audit.py` |
