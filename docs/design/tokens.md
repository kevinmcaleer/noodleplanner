# Design tokens

The single source of truth is
[`packages/noodle-web/src/noodle_web/static/visual-system.css`](../../packages/noodle-web/src/noodle_web/static/visual-system.css).
Every token below is declared there, in a `:root` block for light and a
`[data-theme="dark"]` block for dark. Nothing else in the app should declare a
`--np-*` name.

Everything downstream is generated from that file, never hand-maintained:

```sh
node scripts/token-audit.mjs     # docs/design/tokens/*.json  (Penpot, Style Dictionary)
node scripts/check-contrast.mjs  # WCAG check, exits non-zero on a failure
```

## Why they live in `visual-system.css` and not a new file

The audit's headline finding was that the app had **three** token layers
defining the same names with different values, resolved by stylesheet load
order. Adding the scales below as a fourth file would have been the same
mistake with better intentions. They go in the layer the audit established as
canonical.

## Colour

Unchanged by #1191 apart from two additions. The warm palette (`--np-paper`,
`--np-ink`, `--np-accent`, the `-tint`/`-ink` status pairs) is documented in
[`token-audit.md`](token-audit.md); all 21 of its text pairings already met
WCAG AA and still do.

| Token | Light | Dark | For |
|---|---|---|---|
| `--np-border-control` | `#8C857A` | `#8A8175` | The visual boundary of an interactive control |
| `--np-focus-ring-color` | `#8A6205` | `#EDB52A` | The focus indicator |

### `--np-border-control` vs `--np-border-strong`

WCAG 2.2 SC 1.4.11 wants 3:1 for the visual boundary of a UI component.
`--np-border-strong` is **1.33:1** against the page — an input outlined in it
is invisible to a low-vision user.

It was not simply darkened, because 1.4.11 does not cover decorative
separators, and `--np-border-strong` is mostly used as one: hairlines between
table rows, the edge of a panel. Darkening it would have put heavy rules
through every table in the app to fix a problem that lives on inputs.

So there are now two tokens, and the distinction is *"does the user have to
find this edge?"*:

- **`--np-border-control`** — inputs, selects, textareas, secondary buttons,
  checkboxes. Anything you click or type into. Verified ≥3:1.
- **`--np-border-strong`** / **`--np-border`** / **`--np-hairline`** —
  separators and decoration. No contrast requirement.

## Focus ring

```css
--np-focus-ring-color: #8A6205;   /* #EDB52A in dark */
--np-focus-ring-width: 2px;
--np-focus-ring-offset: 2px;
--np-focus-ring: 0 0 0 var(--np-focus-ring-offset) var(--np-paper),
                 0 0 0 calc(var(--np-focus-ring-offset) + var(--np-focus-ring-width)) var(--np-focus-ring-color);
```

Apply it as a `box-shadow` on `:focus-visible`:

```css
.some-control:focus-visible {
    outline: none;              /* the ring below replaces it */
    box-shadow: var(--np-focus-ring);
}
```

`outline: none` is only acceptable when `var(--np-focus-ring)` replaces it in
the same rule. On its own it is a bug — there are 67 bare ones in the app
today, and #1193 is where they get paired up or removed.

**Why the ring has two layers.** A single marigold ring is invisible on a
marigold button (1:1). A single dark ring is invisible on a dark page. No one
colour clears 3:1 against everything the ring can land on. Painting an inner
halo in `--np-paper` first means the ring always meets `--np-paper`, whatever
is actually underneath, so one token works on both themes and on the primary
button.

## Spacing

There was no spacing token before #1191: 2,522 box-model declarations, exactly
one of them indirected through `var()`.

| Token | Value | | Token | Value |
|---|---|---|---|---|
| `--np-space-0` | `0` | | `--np-space-20` | `20px` |
| `--np-space-2` | `2px` | | `--np-space-24` | `24px` |
| `--np-space-4` | `4px` | | `--np-space-32` | `32px` |
| `--np-space-8` | `8px` | | `--np-space-40` | `40px` |
| `--np-space-12` | `12px` | | `--np-space-48` | `48px` |
| `--np-space-16` | `16px` | | `--np-space-64` | `64px` |

**Named by value, deliberately.** `--np-space-8` can be checked against
`padding: 8px` at a glance during a 26,000-line migration; `--np-space-2`
(Tailwind's name for the same 8px) cannot. The cost is that the names hard-code
the 4px base — if the base ever changes, these get renamed rather than
re-valued. That is the right trade for a retrofit.

**`10px` and `6px` are not in the scale, on purpose.** They are the 2nd and 5th
most used spacing values in the app (449 and 286 uses) and appear in 24 of the
27 stylesheets. The app has two interleaved half-scales — 4/8/12/16 and
5/10/15/25/30 — laid down by different authors. Snapping `10px → 8px` across
449 declarations would visibly move a quarter of the app's layout in one
commit. Each one is a per-surface judgement in #1194.

## Type

| Token | Value | Uses today | | Token | Value | Uses today |
|---|---|---|---|---|---|---|
| `--np-text-75` | `0.75em` | 21 | | `--np-text-110` | `1.1em` | 45 |
| `--np-text-80` | `0.8em` | 76 | | `--np-text-125` | `1.25em` | 40 |
| `--np-text-85` | `0.85em` | 176 | | `--np-text-150` | `1.5em` | 24 |
| `--np-text-90` | `0.9em` | 153 | | `--np-text-180` | `1.8em` | 35 |
| `--np-text-95` | `0.95em` | 64 | | `--np-text-200` | `2em` | 11 |
| `--np-text-100` | `1em` | 26 | | | | |

Named by hundredths of an em, on the same principle as spacing:
`--np-text-85` is `0.85em`.

**Relative units are kept deliberately.** The app nests font-size-relative UI
several levels deep; switching this scale to `rem` would resize things that
currently track their container.

Eleven steps is more than a greenfield system would want, but every one is
backed by at least 19 authored uses, and it takes the count from 67 to 11.
`--np-text-75` absorbs `0.7em` and `--np-text-125` absorbs `1.2em`/`1.3em`;
those two are small visible changes and belong to #1194, not to adding the
token.

### Line height and weight

| Token | Value | | Token | Value |
|---|---|---|---|---|
| `--np-leading-tight` | `1.2` | | `--np-weight-regular` | `400` |
| `--np-leading-snug` | `1.4` | | `--np-weight-medium` | `500` |
| `--np-leading-normal` | `1.6` | | `--np-weight-semibold` | `600` |
| | | | `--np-weight-bold` | `700` |

### Families (unchanged)

| Token | Value |
|---|---|
| `--np-font-heading` | `'Newsreader', Georgia, serif` |
| `--np-font-ui` | `'Instrument Sans', -apple-system, …` |
| `--np-font-data` | `'IBM Plex Mono', 'DejaVu Sans Mono', monospace` |

## Radius

| Token | Value | Authored uses |
|---|---|---|
| `--np-radius-xs` | `2px` | 8 |
| `--np-radius-sm` | `4px` | 202 |
| `--np-radius-md` | `6px` | 138 |
| `--np-radius-lg` | `8px` | 125 |
| `--np-radius-xl` | `12px` | 63 |
| `--np-radius-pill` | `999px` | — |
| `--np-radius-circle` | `50%` | 58 |

**The semantic radii were re-pointed, not kept.** `--np-radius-control`,
`--np-radius-card` and `--np-radius-panel` named `9px`, `11px` and `14px` —
values the app never adopted. Between them they were referenced **three
times**, while the raw `4px`/`6px`/`8px`/`12px` carried the real UI. They are
now aliases:

```css
--np-radius-control: var(--np-radius-lg);   /* 9px  -> 8px  */
--np-radius-card:    var(--np-radius-xl);   /* 11px -> 12px */
--np-radius-panel:   var(--np-radius-xl);   /* 14px -> 12px */
```

That direction costs three changes of 1–2px each. The other direction — making
the app match the tokens — would have changed ~500 declarations to fix nothing
a user can see.

`6px` is kept even though it is off a 4px grid. Corner radius is not layout
rhythm, and 138 uses is not drift.

## Elevation

| Token | Value (light) | For |
|---|---|---|
| `--np-elevation-1` | `0 1px 2px var(--np-shadow-tint)` | A hairline lift |
| `--np-elevation-2` | `0 2px 4px var(--np-shadow-tint)` | A resting card |
| `--np-elevation-3` | `0 4px 12px var(--np-shadow-tint-strong)` | A floating menu or popover |
| `--np-elevation-4` | `0 20px 60px var(--np-shadow-tint-strong)` | A modal over a dimmed page |
| `--np-floating-shadow` | *(unchanged)* | The existing two-layer floating surface |

| Tint | Light | Dark |
|---|---|---|
| `--np-shadow-tint` | `rgba(35,32,28,.10)` | `rgba(0,0,0,.35)` |
| `--np-shadow-tint-strong` | `rgba(35,32,28,.16)` | `rgba(0,0,0,.55)` |

The tint is a separate token so the whole ramp darkens as a set in dark mode
rather than four values needing to be kept in step by hand.

These are new names rather than a redefinition of `--np-shadow` /
`--np-shadow-strong`, which live in `dark-mode.css`. Redefining those here
would have created exactly the cross-file conflict the audit is about.

## Verifying

`node scripts/check-contrast.mjs` reads the token values out of
`visual-system.css` and scores 29 real pairings — text on each surface, labels
on the accent, status text on its tint, control borders, and the focus ring —
in both themes. 58/58 pass.

It composites translucent foregrounds over their background before scoring,
because that is what the browser paints; scoring a raw `rgba()` would pass
things that don't.

Pairings are chosen for what the app actually renders. A token pair that never
meets on screen is not worth a threshold, and asserting one would make the
check noisy enough to ignore.
