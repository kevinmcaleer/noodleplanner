# Token consolidation and design-tool handoff

The [token audit](token-audit.md) counted what exists — at the time it ran,
583 colours, 67 font sizes, 32 radii and 104 box-shadows against a canonical
set of 73 tokens. (The counts below are a few higher: they were regenerated
later, and the stylesheet has grown since. Re-run `npm run audit:tokens` to
bring that report back in step.) This document covers the follow-up question — **which of those values are the same
decision written several ways, and which spelling should win** — plus how the
result reaches Penpot and Storybook.

Everything here is generated. Nothing is hand-maintained:

```sh
npm run audit:tokens   # docs/design/tokens/*.json, token-audit-data.json
npm run design         # consolidation + UI structure map + the explorer page
```

## The explorer

`npm run design:explorer` writes `docs/design/design-system-explorer.html` — a
self-contained page, styled in the app's own Warm Paper / Marigold system, with
two halves:

- **Merge candidates** — every cluster of values a person could not tell apart,
  each shown as a usage bar so the dominant spelling is visible at a glance.
- **Surface map** — every view, detail form and slide-in overlay in the app.

Open the file directly in a browser; it needs no server.

## How clustering works

Colours are compared with **CIEDE2000**, the standard perceptual
colour-difference metric. Two values join a cluster when their ΔE falls under
the threshold — 3 for chromatic colours, and a tighter **1.6 for neutrals**,
because stacked surfaces (page / card / hairline) are deliberately only a few
ΔE apart and a looser bar collapses a whole surface ramp into one swatch.

Three further rules keep clusters honest:

- Opaque and translucent colours cluster separately. `#000` and `#000` at 10%
  opacity have a Lab distance of zero and are not the same decision.
- `transparent` is excluded outright — it is the absence of a colour, not a
  near-miss of a faint tint.
- Clusters are seeded highest-usage-first, so the value anchoring each cluster
  is the one most likely to deserve to win.

Font sizes and radii cluster by numeric proximity within a unit family (`em`
and `px` are never mixed — that would need a cascade-aware base size per
selector, which a static pass cannot know). Shadows cluster on first-layer
geometry plus alpha, which is where copy-paste drift shows up.

Thresholds are CLI-overridable if you want to see a looser or stricter view:

```sh
node scripts/token-consolidation.mjs --color-de=4 --neutral-de=2
```

## What it found

| Category | Unique today | After merging | Declarations involved |
|---|---|---|---|
| Colours | 585 | 376 | 2,671 |
| Font sizes | 67 | 44 | 765 |
| Radii | 32 | 26 | 498 |
| Box-shadows | 104 | 65 | 198 |

Merging only exact perceptual duplicates removes **209 of the 585 colours**
without a single visible change to the app.

### The headline: the app's real palette isn't the design system's

**Only 13 of 105 colour clusters sit close enough to any canonical `--np-*`
token to adopt it** — and none of the high-traffic ones do. The six biggest
clusters, together 1,268 declarations, match nothing in `visual-system.css`:

| Keep | Absorbs | Uses | Canonical token in range? |
|---|---|---|---|
| `#fff` | `#f8f9fa`, `#f9f9f9`, `#fafafa`, `#f8f8f8`, `#fafbfc`, `#fbfdfd`, `#f9fafb` | 549 | none |
| `#e0e0e0` | `#ddd`, `#e4e4e4`, `#e2e2e2`, `#dbdbdb`, `#dedede`, `#e3e3e3` | 218 | none |
| `#333` | `#353535`, `#333334`, `#303031` | 202 | none |
| `#e9ecef` | `#f0f1f4`, `#f0f2f5`, `#eff1f3`, `#eef1f6` | 107 | none |
| `rgba(0,0,0,.1)` | `.08`, `.12`, `.07` | 102 | none |
| `#f0f0f0` | `#f5f5f5`, `#f1f3f5`, `#eee`, `#f4f4f4`, `#f2f2f2`, +5 more | 90 | none |

These are cool Bootstrap-era greys. The canonical system is warm — `--np-paper`
`#FAF8F4`, `--np-surface` `#FFFDF9`, `--np-hairline` `#E3DDD3`. So the top of
the app's usage distribution is not drifting *within* the design system; it
predates it entirely.

That makes the consolidation a two-step job, and the order matters:

1. **Merge duplicates onto one spelling** — mechanical, no visual change,
   removes 209 colours.
2. **Decide whether the survivors adopt the warm palette** — a design decision
   with a visible result, and the one worth taking into Penpot.

Doing step 2 first means re-litigating it once per duplicate.

### The easy wins

- **Shadows.** Ten near-identical shadows account for 75 declarations; the top
  cluster alone (`0 2px 4px rgba(0,0,0,.1)` and nine variations on it) is pure
  copy-paste drift with no design intent behind the differences.
- **Radii.** Four clusters cover 498 declarations. `4px` absorbs `3px` and
  `5px`; `8px` absorbs `9px`; `12px` absorbs `11px` and `13px`. That is most of
  the radius problem for three token definitions.
- **Font sizes.** `0.85em` absorbs `0.88em`, `0.85rem`, `0.82em`, `0.875rem`
  and `.88em` — 176 declarations. The audit's recommendation of a font-size
  scale still stands; this narrows what the scale has to cover first.

## The surface map

`npm run design:map` reads the nav constants in `static/state.js` and the
markup in `templates/index.html` and writes `docs/design/ui-structure.json`
plus `penpot/noodleplanner-ui-structure.mmd`.

| Surface | Count |
|---|---|
| Project views (Plan 15 / Tracking 10 / Resources 5) | 30 |
| Portfolio views | 9 |
| Slide-in panels | 5 |
| Detail forms (sections inside the detail pane) | 16 |
| Modal overlays | 18 |
| Wizard steps | 3 |
| Standalone forms | 2 |

It reads the same constants the router does, so it also catches drift between
the nav and the view groups. Two gaps exist today:

- **`lessons`** is reachable from the nav, but no group in `ALL_PROJECT_VIEWS`
  owns it — so `updatePlanSubnav` never marks the sub-nav active while it is
  open.
- **`escalations`** is listed in `TRACKING_VIEWS`, but no `data-view` in the
  markup offers it.

Neither is fixed here; both are real and worth an issue.

## Penpot

Penpot is the place to *decide* the palette, not to discover the drift — it
sees the tokens you give it, never the 26,045 lines of CSS they are supposed to
govern. Use the explorer to pick the survivors, then use Penpot to design with
them.

**Tokens.** Design → Tokens → Import, pointing at the five files in
`docs/design/tokens/` (`core.json`, `color-light.json`, `color-dark.json`,
`$themes.json`, `$metadata.json`). They are W3C Design Tokens-typed JSON in the
multi-set Tokens Studio convention Penpot reads natively — `$themes.json` maps
the two colour sets onto a Light and a Dark theme, and `$metadata.json` fixes
the order they resolve in. Import all five together; the two `$`-prefixed files
are the ones that make it a themed set rather than three loose lists. Penpot's
Tokens feature has moved fast across releases — if the importer wants a single
merged file instead, check Penpot's own docs for the installed version.

**Screens.** `penpot/noodleplanner-ui-structure.mmd` renders anywhere Mermaid
does (GitHub previews it inline). Export it to SVG and import that as a board
to annotate — the same route the existing `penpot/noodleplanner-sitemap-*.svg`
boards took.

The flow that works: consolidate in CSS → re-run `npm run audit:tokens` →
re-import into Penpot. Penpot stays downstream of the stylesheet, so the two
cannot silently disagree.

## Storybook

**Set up in #1197**, as `@storybook/html-vite`. Run it with:

```sh
npm run storybook          # dev server on :6006
npm run storybook:build    # static build into .storybook-static/
```

This section previously argued Storybook was a poor fit, and the reasoning
still holds for the version of it that was being imagined. NoodlePlanner has no
bundler and no component modules: the UI is one large `index.html` plus
vanilla-JS files that mutate it by `id`. There is no `Button` to write a story
for, and extracting one is a large architectural change that should be
justified on its own merits rather than adopted as a side effect of a token
cleanup.

What changed is the target, not the constraint. Storybook is pointed at what
*does* exist -- the app's real class names against the app's real stylesheets,
rendered as HTML. `@storybook/html-vite` needs no framework and no build step
in the app itself, and nothing about how NoodlePlanner is served changes. The
cost is 92 dev dependencies.

Two things make it trustworthy rather than decorative:

- **`.storybook/main.js` reads the stylesheet list out of `index.html`** rather
  than carrying a copy. Load order decides which of two equal-specificity rules
  wins, which is the exact bug this epic exists to fix, so a Storybook
  rendering components under a stale order would be worse than none.
- **The variants come from `static/component-gallery.js`**, the same module the
  `/components` page renders from. One spec, two consumers.

CSF reads static named exports, so a story cannot be generated per variant in a
loop -- there is one story per *section*, written out. That single
hand-maintained list is the only place the two consumers can drift, and
`tests/test_storybook_stories.py` fails when a section has no story. Adding a
variant needs no change anywhere.

The token files are also ready for a theme decorator if one is ever wanted: run
`docs/design/tokens/*.json` through [Style Dictionary](https://styledictionary.com/)
v4+, which reads DTCG `$type`/`$value` natively. Not needed today -- the
preview loads the app's own CSS, so the tokens are simply there.

## Suggested order of work

1. Delete the shadowed `:root` token block in `dark-mode.css` (audit
   recommendation 1) — until then "which token wins" has two answers.
2. Merge the shadow and radius clusters. Small, mechanical, high volume.
3. Merge the colour clusters onto one spelling each. Still no visual change.
4. *Then* decide, in Penpot, whether the surviving greys adopt the warm
   palette. This is the only step with a visible result.
5. Re-run `npm run audit:tokens && npm run design` and watch the unique-value
   counts fall.
