# Token audit — NoodlePlanner web app

**Scope:** `packages/noodle-web/src/noodle_web/static/**/*.css` (27 files, 26,045
lines of CSS). The Obsidian plugin's stylesheet
(`packages/obsidian-noodle-planner/styles/styles.css`) is a separate surface
and is not covered by this pass.

**Method:** [Project Wallace](https://www.projectwallace.com)'s open-source CSS
tooling — [`@projectwallace/css-analyzer`](https://github.com/projectwallace/css-analyzer)
for stylesheet metrics, and [`@projectwallace/css-design-tokens`](https://github.com/projectwallace/css-design-tokens)
to turn raw CSS values into candidate design tokens. Re-run the whole audit
with:

```sh
npm run audit:tokens
```

This regenerates `docs/design/tokens/*.json` and `docs/design/token-audit-data.json`
(the raw data this report is written from). The script is
`scripts/token-audit.mjs`.

## Headline finding: three token systems are live at once

The app doesn't have one design system today — it has three, layered on top
of each other by load order, and they define **the same `--np-*` custom
property names with different values**:

| Layer | File(s) | Scoped by | Status |
|---|---|---|---|
| **Warm Paper / Marigold** (epic #998, current) | `visual-system.css` | `:root`, `[data-theme="dark"]` | Latest redesign, 73 tokens, wins the cascade for anything it redefines |
| **Blue identity** (issue #1024, superseded) | `dark-mode.css` (2,864 lines) | `:root` for its own "light defaults", then ~575 separate `[data-theme="dark"] .selector {}` component overrides | Its `:root` token block is dead wherever `visual-system.css` redefines the same name (loads later in `index.html`); everything else in the file — the 575 component-level dark-mode overrides, plus tokens it doesn't share a name with — is still live |
| **Chart/minimap legacy** | `base.css`, `style.css`, `components.css` | `:root` + their own `[data-theme="dark"]` blocks | Fully live: `--evm-*` (EVM charts) and `--mm-*` (mind-map) tokens are untouched by the other two layers |

`index.html` loads them in this order: `base.css` → `components.css` → … →
`dark-mode.css` → `visual-system.css`. Equal-specificity `:root` rules resolve
by source order, so **`visual-system.css` wins for any name it redefines** —
but nothing removed the losing declarations, so the file is 2,864 lines of
partially-dead, partially-load-bearing CSS that looks authoritative on a
read-through.

`dark-mode.css`'s own header and comments confirm this is a historical layer,
not a mistake to silently paper over:

> Applied via `[data-theme="dark"]` on `<html>`
> … built from the app's own `--np-red/orange/yellow/green/blue/dark-blue`
> palette (`base.css`) rather than the generic indigo/purple template
> gradient … The approved design-handoff ZIP linked from the parent epic
> (#998) 404s/403s for this session, so these are a documented interim
> identity …

That "interim identity" is `--np-accent: var(--np-blue)` (`#108BB9`-family
blue) — and it's exactly the layer `visual-system.css`'s marigold
`--np-accent: #EDB52A` was meant to replace. 79 custom properties are defined
more than once with **conflicting values** across these layers; the 10
highest-traffic examples:

| Token | Winning value (`visual-system.css`) | Shadowed value (`dark-mode.css`'s own `:root` block; several of these also carry a second, dark-specific value in `dark-mode.css`'s own `[data-theme="dark"]` block, omitted here for brevity) |
|---|---|---|
| `--np-accent` | `#EDB52A` | `var(--np-blue)` → `#108BB9` |
| `--np-accent-hover` | `#D9A31C` | `#0d7096` |
| `--np-font-heading` | `'Newsreader', Georgia, serif` | `'Manrope', …, sans-serif` |
| `--np-font-ui` | `'Instrument Sans', …` | `'Inter', …` |
| `--np-surface` | `#FFFDF9` | `#ffffff` |
| `--np-border` | `#E3DDD3` | `#e0e0e0` |
| `--np-text` (dark theme value) | `#FAF8F4` (via `--np-ink`) | `#e0e0e0` |
| `--np-editor-bg` | `#201E1A` | `#1e1e1e` |
| `--np-accent-gradient` | `var(--np-accent)` (solid marigold) | `linear-gradient(135deg, var(--np-blue) 0%, var(--np-green) 100%)` |
| `--np-bg` | `var(--np-paper)` | `#ffffff` |

The full list of 79 is in `docs/design/token-audit-data.json` →
`customProperties.conflictingMultiFileDefinitions`.

**Why this matters for standardisation:** anyone editing `dark-mode.css`
today — the file whose name says "this is where dark mode lives" — is mostly
editing dead code for the tokens `visual-system.css` already owns, while
unknowingly still controlling ~575 real component overrides for everything
else. That's the opposite of discoverable. Before Storybook/Penpot tokens can
be a source of truth, this needs a decision on which layer is canonical (this
audit assumes `visual-system.css`, since it's newest and wins the cascade)
and a cleanup pass to delete the shadowed declarations — tracked as a
follow-up, not done in this pass (see "Recommendations").

## CSS health snapshot

| Metric | Value |
|---|---|
| Files scanned | 27 |
| Source lines of CSS | 26,045 |
| Rules | 5,772 |
| Unique selectors | 3,847 |
| Max selector specificity | `(2,1,0)` |
| Custom property declarations | 483 (147 unique names) |
| Unique colors in use | 583 |
| Unique font-size values | 67 |
| Unique font-family stacks | 4 |
| Unique line-height values | 16 |
| Unique border-radius values | 32 |
| Unique box-shadow values | 104 |

For comparison, the canonical `visual-system.css` token set is **73 tokens**
total (colors, 3 fonts, 3 radii, 1 shadow) across light and dark. A healthy
design system for an app this size would expect the *used-value* counts
above (colors, font-sizes, radii, shadows) to converge toward the *token*
count — right now they're 5–100x larger, which is the audit's other
throughline: most values are one-offs, not tokens.

## Dead and orphaned custom properties

Computed by direct text cross-reference (`grep`-equivalent) rather than
`css-analyzer`'s built-in `properties.custom.used/unused`, because that
metric under-counts `var()` references inside properties it doesn't model
for var-detection — confirmed directly: `var(--np-font-heading)` appears four
times in `visual-system.css` itself, yet `css-analyzer` still reports
`--np-font-heading` as unused. Treat this report's numbers as the reliable
ones for this specific question.

**29 custom properties are defined but never referenced anywhere**
(`docs/design/token-audit-data.json` → `customProperties.unused`), mostly
`--evm-line-*` chart-series colors, `--mm-*` mind-map tokens, and dead
`dark-mode.css` tokens like `--np-warning*`/`--np-info`/`--np-sage`/
`--np-radius-card`. These are safe deletion candidates once someone confirms
they're not read from JS (`getComputedStyle`) rather than CSS.

**14 names are referenced via `var()` but never defined anywhere** —
`--np-link`, `--np-link-hover`, `--np-warn-bg`, `--np-warn-border`,
`--np-purple`, `--np-dark-grey`, `--bs-primary`, `--surface-hover`,
`--wb-outline-depth`, plus animation-only custom properties set inline by JS
(`--circumference`, `--percent`, `--tx`, `--ty`,
`--pf-restless-amplitude`). The first group look like typos or removed
tokens still referenced from CSS — each one silently falls back to the
browser's initial/inherited value rather than erroring, so they're worth a
manual look (`customProperties.unknown` in the data file).

## Raw color audit

583 unique colors are used across the app against a canonical palette of
~30 colors. Only 9 raw hex literals exactly duplicate an existing token's
value and are used more than once outside their own token definition —
i.e. genuine "should have used `var(--np-x)`" cases
(`colors.duplicateOfToken` in the data file, e.g. `#EDB52A` used twice
outside `--np-accent`'s own definition, `#F3EEE5` twice outside
`--np-surface-alt`).

The bigger story is the long tail of colors that don't match any token at
all. Top 10 by usage count:

| Color | Uses | Notes |
|---|---|---|
| `#FFFFFF` (`#fff`, `white`) | 454 | Overwhelmingly the highest-traffic literal color in the app |
| `#333333` (`#333`) | 198 | Legacy near-black text color, predates `--np-ink`/`--np-text` |
| `#E0E0E0` | 187 | Legacy border/background grey |
| `transparent` | 162 | |
| `#108BB9` | 153 | The "blue identity" (issue #1024) accent — same family as the `dark-mode.css` `--np-blue`/`--np-accent` values above |
| `#666666` (`#666`) | 116 | |
| `#F8F9FA` | 81 | Bootstrap's default `bg-light`, unrelated to either token system |
| `rgba(0,0,0,.1)` | 78 | Ad hoc shadow tint, competes with `--np-shadow` |
| `#DEE2E6` | 74 | Bootstrap default border grey |
| `#E9ECEF` | 70 | Bootstrap default surface grey |

Several of the top offenders (`#F8F9FA`, `#DEE2E6`, `#E9ECEF`, `#6C757D`,
`#ADB5BD`) are literally Bootstrap's default greyscale palette, not anything
from either NoodlePlanner token system — a sign large parts of the CSS
predate both design passes. Full ranked list (top 25) in
`colors.topUnmatched` in the data file.

## Typography, radius, and shadow audit

- **67 distinct font-size values**, dominated by unitless `em` multipliers
  (`0.85em` × 145, `0.9em` × 131, `0.95em` × 63, `0.8em` × 55 …) rather than a
  scale. There is no `--np-font-size-*` token today. Standardising this is
  probably the single highest-leverage change: a half-dozen `em` values
  would likely absorb most of the 67.
- **32 distinct border-radius values**; the token set only defines 3
  (`--np-radius-control: 9px`, `--np-radius-card: 11px` — itself in the
  unused list — and `--np-radius-panel: 14px`). `4px`/`6px`/`8px`/`12px` each
  have 60–200 uses and don't map to any token.
- **104 distinct box-shadow values**; only `--np-shadow`, `--np-shadow-strong`
  (legacy) and `--np-floating-shadow` (current) exist as tokens, referenced
  in fewer than 40 of the 104. Most shadows are one-off
  `rgba(0,0,0,N)` tuples with slightly different offsets/blurs/opacities —
  classic copy-paste drift.
- Only **4 distinct font-family stacks** outside the token system (a
  monospace fallback chain, a Bootstrap-era system-font stack, and two
  variants of `'Courier New'`) — typography is comparatively well contained
  already, once `dark-mode.css`'s shadowed `--np-font-heading`/`--np-font-ui`
  values are deleted.

## Exported design tokens

`docs/design/tokens/` contains the canonical **73 tokens from
`visual-system.css`** (the layer that currently wins the cascade), exported
as [W3C Design Tokens](https://tr.designtokens.org/format/)-typed JSON in the
multi-set convention used by [Tokens Studio](https://tokens.studio/) and
read natively by Penpot's Tokens tab:

- `core.json` — typography, radius and shadow tokens (theme-independent)
- `color-light.json` / `color-dark.json` — the two color sets
- `$themes.json` — maps a "Light" and "Dark" theme to which sets are enabled

**Import into Penpot:** Design → Tokens tab → Import, pointing at the four
files in `docs/design/tokens/`. Penpot's Tokens feature has moved fast across
recent releases, so verify the exact import flow against the installed
version — the multi-set + `$themes.json` shape is the de facto standard both
Tokens Studio and Penpot's plugin have converged on, but check Penpot's own
docs if the importer expects a single merged file instead.

**Feed into Storybook:** run these four files through
[Style Dictionary](https://styledictionary.com/) (v4+ reads DTCG `$type`/
`$value` natively) to emit CSS custom properties, a JS/TS token module, or
whatever format the Storybook theme decorator needs. `core.json`'s `shadow`
token stores the raw multi-layer `box-shadow` string rather than a decomposed
`{color, offsetX, offsetY, blur, spread}` object — pragmatic since
`--np-floating-shadow` is a two-layer shadow and lossless decomposition
wasn't worth the risk of a transcription error; treat it as a string-typed
token in Style Dictionary rather than the strict DTCG shadow object.

These files describe **what already exists** in `visual-system.css` — they
don't yet incorporate fixes for the dead/conflicting tokens above. Once the
cleanup work happens, re-run `npm run audit:tokens` to regenerate them.

## Recommendations (not done in this pass)

This audit is intentionally read-only — no CSS was changed. Suggested
follow-ups, roughly in priority order:

1. **Decide and document which token layer is canonical** (this audit assumes
   `visual-system.css`), then delete the shadowed `:root` token block in
   `dark-mode.css` (keep its ~575 component-level dark-mode overrides — those
   are still live).
2. **Fix the 14 `--np-*`/etc. references with no definition** — likely typos
   or leftovers from a rename.
3. **Introduce a font-size scale** (`--np-font-size-xs/sm/base/lg/xl…`) to
   absorb the 67 raw values; this is the highest-leverage single change.
4. **Add spacing/radius tokens** beyond the current 3, and migrate the
   highest-traffic raw radii (`4px`, `6px`, `8px`, `12px`).
5. **Consolidate `box-shadow` one-offs** onto `--np-shadow`/
   `--np-shadow-strong`/`--np-floating-shadow`, or add 1–2 more tokens if the
   existing three don't cover legitimate variants (e.g. focus rings).
6. **Delete the 29 unused custom properties** (after confirming none are read
   from JS).
7. Re-run `npm run audit:tokens` after each pass to track convergence —
   the "unique values found" numbers in the CSS health snapshot are the
   metric to watch trending down.
