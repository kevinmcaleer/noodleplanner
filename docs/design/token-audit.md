# Token audit — NoodlePlanner web app

**Scope:** the 26 stylesheets `templates/index.html` actually links, in load
order — 17,584 lines of CSS — plus the Jinja templates and the app's own
JavaScript, both of which author styles a CSS-only audit cannot see.

`static/style.css` is **excluded**: 13,170 lines that #571 stopped linking and
nothing removed. Scanning it made every number in this report describe code the
browser never sees — 45 of the 79 "conflicting token definitions" the first
pass reported were conflicts with that dead file alone. The Obsidian plugin's
stylesheet (`packages/obsidian-noodle-planner/styles/styles.css`) is a separate
surface and is not covered.

**Method:** [Project Wallace](https://www.projectwallace.com)'s CSS tooling —
[`@projectwallace/css-analyzer`](https://github.com/projectwallace/css-analyzer)
for stylesheet metrics and
[`@projectwallace/css-design-tokens`](https://github.com/projectwallace/css-design-tokens)
for token candidates — plus purpose-built passes for spacing, components and
non-CSS style. Re-run everything with:

```sh
npm run audit:tokens     # docs/design/tokens/*.json + token-audit-data.json
npm run check:contrast   # WCAG check against the token values
```

The script is `scripts/token-audit.mjs`; this report is written from
`docs/design/token-audit-data.json`.

---

## Status of the original findings

| Finding | Then | Now |
|---|---|---|
| Three token layers defining the same names | 79 conflicts | **0** — #1192 |
| `var()` references with no definition | 14 | **0** — #1192 |
| Components styled only in unlinked CSS | not detected | **0** — #1194 recovered 54 |
| Unused custom properties | 29, of which 18 were false | 20, of which 19 are new scales awaiting adoption |
| No spacing / type / elevation tokens | none existed | scales defined — #1191 |
| Palette contrast | unverified | 58/58 pairings pass, 2 defects fixed — #1191 |

What remains is the long tail: 549 colours, 68 font sizes, 48 spacing values
and 825 component class names, which bands 2–4 of the
[backlog](standardisation-backlog.md) work through.

---

## Resolved: three token systems were live at once

**Fixed in #1192.** Recorded because the shape of the problem explains most of
what the rest of this audit found.

The app had three token layers, stacked by stylesheet load order, **defining
the same `--np-*` names with different values**:

| Layer | File | Status then |
|---|---|---|
| Warm Paper / Marigold (#998) | `visual-system.css` | Newest, won the cascade for anything it redefined |
| Blue identity (#1024) | `dark-mode.css` | Its `:root` block was dead wherever `visual-system.css` redefined the same name |
| Chart legacy | `base.css` | Its `--evm-*` surface tokens were bridged, and shadowed, by `visual-system.css` |

`index.html` loads them `base.css` → … → `dark-mode.css` → `visual-system.css`.
Equal-specificity `:root` rules resolve by source order, so `visual-system.css`
won for any name it redefined — but nothing removed the losing declarations.
`dark-mode.css`, the file whose name says "this is where dark mode lives", was
mostly dead code for the tokens it appeared to own, while still controlling
~575 real component overrides for everything else.

#1192 deleted the shadowed declarations: 34 from `dark-mode.css` and 10 from
`base.css`. `dark-mode.css`'s `:root` block went from 50 names to 9, and its
component-level dark overrides were left untouched. Seven further #1024
leftovers (`--np-success`, `--np-warning` and variants, `--np-info`,
`--np-font-mono`) were referenced by nothing at all and went with them.

**One caveat carried forward:** what survives in `dark-mode.css` is still the
*blue* identity — `--np-danger` is `var(--np-red)`, `--np-accent-soft` is a
blue tint. Reconciling those with the warm `--np-danger-ink` /
`--np-accent-tint` is a palette decision, left open for #1194.

### Measuring conflicts honestly

The 79-conflict figure counted any name declared in two files with different
values. That over-counted twice over: 45 were conflicts with the dead
`style.css`, and the rest included component-scoped theming — a mind-map
setting `--mm-btn-bg` on its own selector for light and again for dark is
normal, not a conflict.

The metric now only counts names declared **at global token scope**
(`:root` / `[data-theme="dark"]`) in more than one file. That number is 0.

## CSS health snapshot

| Metric | Value | First pass (incl. dead CSS) |
|---|---|---|
| Files scanned | 26 linked | 27 |
| Source lines of CSS | 17,584 | 26,045 |
| Rules | 3,929 | 5,772 |
| Unique selectors | 3,820 | 3,847 |
| Max selector specificity | `(2,1,0)` | `(2,1,0)` |
| Custom property declarations | 308 (189 unique names) | 483 (147) |
| Canonical tokens in `visual-system.css` | 122 | 73 |
| Unique colours in use | 549 | 583 |
| Unique font-size values | 68 | 67 |
| Unique font-family stacks | 4 | 4 |
| Unique border-radius values | 36 | 32 |
| Unique box-shadow values | 98 | 104 |
| Unique spacing values | 48 (24 off a 4px grid) | not measured |
| Distinct component class names | 825 across 7 families | not measured |

The token count rose from 73 to 122 because #1191 added the spacing, type,
elevation and focus scales. The used-value counts are what should now fall
toward it; right now colours are 4.5× the token count and shadows 24×.

## Custom properties

**0 names are referenced but never defined** (was 14). Seven were real gaps and
were fixed in #1192 — `--np-link`/`--np-link-hover` now alias the accent
family, `--np-warn-bg`/`--np-warn-border` point at `--np-accent-tint`,
`--np-purple` is declared next to the other identity hues, `--surface-hover`
became `--np-bg-hover`. The rest were never gaps: `--bs-primary` comes from
Bootstrap's CDN stylesheet, and six more are set as inline styles by JS. The
audit allowlists those rather than reporting them forever.

`--np-dark-grey` was the only one of the seven that was actually broken rather
than cosmetic: it had **no fallback**, so `color: var(--np-dark-grey)` on the
context-loading text was invalid at computed-value time and the text silently
inherited its parent's colour.

**20 are defined but never referenced**, and 19 of those are the #1191 scales
awaiting adoption in bands 2–4. The twentieth is `--np-ink-hover`, part of
#998's published palette; it is left in place rather than deleted piecemeal.

### Why the first pass's "unused" list was wrong

It reported 29, of which **18 were false**. `mindmap.js` and `script.js` read
tokens off the root element with `getComputedStyle().getPropertyValue()`, which
a CSS-only scan cannot see — every `--evm-line-*` chart series colour and the
whole `--mm-*` mind-map set was on that list. Deleting them on that evidence
would have blanked the EVM chart lines. The audit now scans the JS too, and
counts only a quoted token name or a `var()` reference for a name some
stylesheet already declares.

A second false positive came from the other direction:
`.ben-view-btn--active:hover` read as a declaration of `--active`. Declaration
matching now requires a `{`, `;` or whitespace before the name.

## Raw colour audit

549 unique colours against a canonical palette of ~40. Only 10 raw hex literals
exactly duplicate a token's value and are used more than once — the genuine
"should have used `var(--np-x)`" cases. The bigger story is the long tail that
matches no token at all:

| Colour | Uses | Notes |
|---|---|---|
| `#FFFFFF` (`#fff`, `white`) | ~450 | The highest-traffic literal in the app |
| `#333333` (`#333`) | ~200 | Legacy near-black text, predates `--np-ink` |
| `#E0E0E0` | ~185 | Legacy border/background grey |
| `transparent` | ~160 | |
| `#108BB9` | ~150 | The #1024 "blue identity" accent |
| `#666666` (`#666`) | ~115 | |
| `#F8F9FA` | ~80 | Bootstrap's `bg-light`, from neither token system |
| `rgba(0,0,0,.1)` | ~78 | Ad hoc shadow tint, competes with `--np-shadow` |
| `#DEE2E6` | ~74 | Bootstrap default border grey |
| `#E9ECEF` | ~70 | Bootstrap default surface grey |

Several of the top offenders are literally Bootstrap's default greyscale — a
sign large parts of the CSS predate both design passes. Exact ranked figures
are in `colors.topUnmatched` in the data file.

## Typography, radius and shadow

- **68 font-size values**, dominated by `em` multipliers (`0.85em` × 145,
  `0.9em` × 131, `0.95em` × 63, `0.8em` × 55). #1191 defines an 11-step scale;
  adoption is band 4.
- **36 radius values** against 7 scale steps. `4px`, `6px`, `8px` and `12px`
  carry the real UI and are now all tokens.
- **98 box-shadow values** against 5 elevation tokens. Most are one-off
  `rgba(0,0,0,N)` tuples a few hundredths apart — copy-paste drift, not intent.
- **4 font-family stacks** outside the token system. Typography is
  comparatively well contained.

## Spacing

Before #1191 there were no spacing tokens at all. Of 1,606 box-model
declarations, 47 are now indirected through `var()`/`calc()` — up from 1. The
rest resolve to **48 distinct values**, of which **24 are off a 4px grid**,
accounting for **894 uses**.

| Value | Uses | On 4px grid |
|---|---|---|
| `0` | 413 | ✅ |
| `10px` | 267 | ❌ |
| `8px` | 264 | ✅ |
| `4px` | 204 | ✅ |
| `6px` | 193 | ❌ |
| `12px` | 171 | ✅ |
| `20px` | 147 | ✅ |
| `2px` | 108 | ❌ |
| `15px` | 92 | ❌ |
| `16px` | 87 | ✅ |

The shape matters more than the count. `10px` and `6px` are the 2nd and 5th
most used values and are spread as evenly across files as `8px` and `4px` are.
This is not a grid with violations; it is **two interleaved half-scales**, a
4/8/12/16 one and a 5/10/15/25/30 one, laid down by different authors.

That rules out a find-and-replace: snapping `10px → 8px` and `15px → 16px`
would visibly move a quarter of the app's layout in one commit. The migration
is per-surface and eyeballed, which is why it is band 4 rather than band 1.

`0` leading the table is expected and healthy — it is the reset value, is
grid-agnostic, and needs no token.

## Component inventory

Grouped by the family a rule's class names imply, matched on
**hyphen-separated segments** rather than substrings, so `.kanban-btn` and
`.btn-primary` are buttons while `.subtotal` is not a total. A selector naming
two families counts once in each.

| Family | Rules | Distinct class names | Files | `:hover` | `:focus` | `:active` | disabled |
|---|---|---|---|---|---|---|---|
| table | 828 | 212 | 18 | 127 | 23 | 0 | 2 |
| button | 513 | 136 | 21 | 172 | 37 | 5 | 25 |
| nav | 386 | 129 | 17 | 54 | 10 | 2 | 12 |
| badge | 235 | 114 | 21 | 12 | 3 | 0 | 0 |
| modal | 208 | 82 | 14 | 26 | 16 | 0 | 0 |
| card | 196 | 84 | 16 | 20 | 6 | 2 | 1 |
| input | 194 | 68 | 17 | 13 | 32 | 0 | 0 |

**825 distinct component class names** for what a design system would express
in perhaps a dozen components with variants. Buttons are the clearest case: 136
differently-named button classes over 21 files, led by `btn-primary` (31
rules), `btn-secondary` (24), `close-btn` (22), `toolbar-btn` (18). Most are
the *same button* re-specified per view.

The state columns are the more urgent finding. Against 513 button rules there
are 172 `:hover` rules and **37** `:focus` ones. Badges are worse in relative
terms: 114 class names, 3 focus rules. No family styles `:active` more than a
handful of times. There are also **67 bare `outline: none` declarations** and
five competing focus colours.

Read the `:hover`-to-`:focus` ratio as an indicator, not a defect count — some
of those rules are on non-interactive elements, and some elements inherit a
ring from a shared base rule. The number says where to look; #1193 is where
each family gets checked properly.

## Styles authored outside CSS

| Source | Count |
|---|---|
| `style="…"` attributes in Jinja templates | 270 (267 in `index.html`) |
| …containing a colour literal | 33 |
| JS files with colour literals in style-shaped code | 22 |
| Lines of such JS | 214 |

Concentrated in `script.js` (50 lines), `views-products.js` (41),
`views-tables.js` (18), `benefits.js` (14), `mindmap.js` (12) and
`whiteboard-notes.js` (12).

Not all are defects. `whiteboard-notes.js` computes a WCAG-contrasting text
colour for a user-chosen note background at runtime, which is exactly where
that belongs and is documented as deliberate in `visual-system.css`. Chart and
canvas code has to hand real colour strings to a drawing API. The rest — static
colours baked into generated markup — belong behind tokens, and #1195's linter
needs an allowlist rather than a blanket ban.

## Unlinked stylesheets

`static/style.css`, 13,170 lines, linked by no template since #571 split it
into the modular stylesheets. `tests/test_collab_session.py` already asserted
it was unlinked.

The split was **incomplete**: 54 classes the running app still sets were left
behind in it, so the progress toast, the baseline history dialog, the AI
settings modal, the editor's YAML front-matter highlighting and six other
features rendered unstyled from that commit until #1194 recovered them.
`tests/test_orphaned_styles.py` now fails on any recurrence.

The file itself is left in place: it is the only record of the intended styling
for the ~28 remaining stranded classes that nothing references, and deleting
13k lines is a separate decision from fixing the bug.

## Exported design tokens

`docs/design/tokens/` holds the canonical tokens from `visual-system.css`,
exported as [W3C Design Tokens](https://tr.designtokens.org/format/)-typed JSON
in the multi-set convention [Tokens Studio](https://tokens.studio/) uses and
Penpot reads natively:

- `core.json` — typography, spacing, radius, elevation and focus (theme-independent)
- `color-light.json` / `color-dark.json` — the two colour sets
- `$themes.json` — maps a Light and a Dark theme onto those sets
- `$metadata.json` — fixes the order the sets resolve in

See [`tokens.md`](tokens.md) for the token reference and
[`consolidation-and-handoff.md`](consolidation-and-handoff.md) for the Penpot
and Storybook handoff.

Composite values are resolved on export, so `--np-elevation-2` ships as
`0 2px 4px rgba(35,32,28,.10)` rather than the literal string
`0 2px 4px var(--np-shadow-tint)`, which would mean nothing to a design tool.

## What is left

Tracked in [`standardisation-backlog.md`](standardisation-backlog.md). In
priority order: focus states across every component family (#1193), the
mechanical value merges (#1194), the per-surface spacing migration (#1194), and
the linter that stops it recurring (#1195).
