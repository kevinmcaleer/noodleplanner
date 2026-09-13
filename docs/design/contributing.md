# Working on NoodlePlanner's UI

What CI checks, and how to decide between a token, a component and a one-off.

Run both gates before you push — they take seconds and need no browser:

```sh
npm run lint:design      # hardcoded colours, off-scale spacing, focus, token placement
npm run check:contrast   # WCAG AA across every token pairing the app renders
```

Or `ci/run.sh design`, which is what CI runs.

## The rules

### 1. Tokens live in `visual-system.css`, nowhere else

Any `--np-*` declared on `:root` or `[data-theme="dark"]` in another
stylesheet is a violation.

This is not tidiness. The app previously had **three** token layers defining
the same names with different values, resolved only by stylesheet load order,
and `dark-mode.css` — the file whose name says "this is where dark mode lives"
— was dead code for every token it appeared to own. See
[`token-audit.md`](token-audit.md).

A custom property scoped to a component's own selector is fine and normal.
It is only the global scope that is reserved.

### 2. Colour comes from a token

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

If your case genuinely belongs outside the system, add an entry to `ALLOW`
with the reason. Adding one is a reviewable act; a lint suppression comment
would not be.

### 3. Spacing comes from the scale

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

### 4. Removing a focus outline means replacing it

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

`check:contrast` is absolute. It scores 29 pairings the app actually renders —
text on each surface, labels on the accent, status text on its tint, control
borders, the focus ring — in both themes, and all 58 pass.

There is no legitimate version of body text at 4:1 or a focus ring at 2:1, so
there is nothing to ratchet. If you change a palette value and this fails, the
value is wrong.

Two distinctions the checker encodes, both worth knowing:

- **`--np-border-control` vs `--np-border-strong`.** WCAG 2.2 SC 1.4.11 wants
  3:1 for the boundary of a UI component, and nothing for decorative
  separators. Anything the user has to find the edge of — inputs, selects,
  secondary buttons — uses `--np-border-control`. Row hairlines and panel edges
  use `--np-border`/`--np-border-strong` and are not checked.
- **The focus ring is two-layer.** An inner halo in `--np-paper`, then the
  ring. No single colour clears 3:1 against both a dark page and a marigold
  button, so the halo means the ring always meets `--np-paper` whatever is
  underneath.

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
```

## Where things are

| | |
|---|---|
| Tokens | `packages/noodle-web/src/noodle_web/static/visual-system.css` |
| Token reference | [`tokens.md`](tokens.md) |
| What the audit found | [`token-audit.md`](token-audit.md) |
| What is left, in order | [`standardisation-backlog.md`](standardisation-backlog.md) |
| Design-tool handoff | [`consolidation-and-handoff.md`](consolidation-and-handoff.md) |
| Gallery spec | `static/component-gallery.js` |
| Linter | `scripts/lint-design-system.mjs` |
| Contrast check | `scripts/check-contrast.mjs` |
| CI job | `ci/jobs/design.sh` |
| Storybook | `.storybook/` |
| Screen-audit capture | `scripts/capture_screen_audit.py` |
