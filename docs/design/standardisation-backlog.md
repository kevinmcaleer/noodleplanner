# Standardisation backlog

The prioritised work list for epic [#1187](https://github.com/kevinmcaleer/noodleplanner/issues/1187),
derived from [`token-audit.md`](token-audit.md) (what exists) and
[`consolidation-and-handoff.md`](consolidation-and-handoff.md) (what can be
merged). Read those two first; this file only decides **order**.

Regenerate the evidence behind every number here with:

```sh
npm run audit:tokens   # docs/design/token-audit-data.json
npm run design         # docs/design/token-consolidation.json + ui-structure.json
```

## How this is ordered

Four bands, and the order between them is not a preference — each one makes
the next cheaper or safer:

1. **Foundations** — one answer to "which token wins", then tokens for the
   categories that have none. Nothing below can be done without this, because
   until it lands, "use the token" has two possible meanings.
2. **Mechanical merges** — collapse duplicate spellings onto one value each.
   No visual change, high volume. Done before any redesign so a palette
   decision is taken once rather than once per duplicate.
3. **Components** — the 848 class names, and the interactive states they are
   missing.
4. **Surfaces** — the per-view rollout, where the remaining judgement calls
   live.

Governance (the linter) is deliberately **not** last. It goes in as soon as
band 1 lands, in warn-only mode, so bands 2–4 do not have to be re-policed by
hand.

Within a band, items are ordered by (declarations affected ÷ risk).

---

## Band 1 — Foundations

Blocks everything. Target: `visual-system.css` is unambiguously the only
place a token is defined.

| # | Item | Affects | Risk | Issue |
|---|---|---|---|---|
| 1.1 | Delete the shadowed `:root` token block in `dark-mode.css`, keeping its ~575 component-level dark overrides | 79 conflicting names | Low — the deleted declarations already lose the cascade | [#1192](https://github.com/kevinmcaleer/noodleplanner/issues/1192) |
| 1.2 | Resolve the 14 `var()` references with no definition | 14 names | Low, but each needs a judgement (typo vs. removed token vs. set from JS) | [#1192](https://github.com/kevinmcaleer/noodleplanner/issues/1192) |
| 1.3 | Add a **spacing scale**. There is none today: 2,522 declarations, 1 indirected | 2,522 declarations | Low to add, high to adopt | [#1191](https://github.com/kevinmcaleer/noodleplanner/issues/1191) |
| 1.4 | Add a **font-size scale**. 67 raw values, no token | 765 declarations | Low to add | [#1191](https://github.com/kevinmcaleer/noodleplanner/issues/1191) |
| 1.5 | Extend the **radius** and **shadow** token sets to cover real usage | 498 + 198 declarations | Low | [#1191](https://github.com/kevinmcaleer/noodleplanner/issues/1191) |
| 1.6 | Delete the 28 unused custom properties, after confirming none are read via `getComputedStyle` | 28 names | Low, given the JS check | [#1192](https://github.com/kevinmcaleer/noodleplanner/issues/1192) |

**1.3 and 1.5 carry a decision, not just an addition.** The canonical radii
(`9px`/`11px`/`14px`) do not match what the app actually uses (`4px` × 200,
`8px` × 125, `12px` × 63). One of the two is wrong. Adopting the authored
values means the token set describes the app and adoption is nearly free;
adopting the canonical values means ~500 declarations change appearance. The
same question applies to spacing, where the app uses two interleaved
half-scales (4/8/12/16 and 5/10/15/25/30) and neither is in the token set.

## Band 2 — Mechanical merges

No visual change by construction: every merge below is between values already
judged perceptually identical (ΔE2000 thresholds in
`token-consolidation.json` → `thresholds`).

| # | Item | Removes | Declarations | Issue |
|---|---|---|---|---|
| 2.1 | Merge the 18 shadow clusters | 39 of 104 shadows | 198 | [#1194](https://github.com/kevinmcaleer/noodleplanner/issues/1194) |
| 2.2 | Merge the 4 radius clusters (`4px` absorbs `3px`/`5px`; `8px` absorbs `9px`; `12px` absorbs `11px`/`13px`) | 6 of 32 radii | 498 | [#1194](https://github.com/kevinmcaleer/noodleplanner/issues/1194) |
| 2.3 | Merge the 14 font-size clusters (`0.85em` absorbs 5 spellings, 176 declarations) | 23 of 67 sizes | 765 | [#1194](https://github.com/kevinmcaleer/noodleplanner/issues/1194) |
| 2.4 | Merge the 105 colour clusters onto one spelling each | 209 of 586 colours | 2,671 | [#1194](https://github.com/kevinmcaleer/noodleplanner/issues/1194) |

2.1 is first because it is the smallest and proves the workflow. 2.4 is last
because it is the largest and benefits most from the other three having
shaken out the review process.

## Band 3 — Components

| # | Item | Affects | Issue |
|---|---|---|---|
| 3.1 | **Focus states.** 693 button rules, 242 `:hover`, 45 `:focus`. Badges: 119 class names, 4 focus rules | Accessibility across the whole app | [#1193](https://github.com/kevinmcaleer/noodleplanner/issues/1193) |
| 3.2 | Collapse the 137 button class names onto a base + variants | 693 rules, 22 files | [#1193](https://github.com/kevinmcaleer/noodleplanner/issues/1193) |
| 3.3 | Same for badges (119), cards (94), inputs (68) | 891 rules | [#1193](https://github.com/kevinmcaleer/noodleplanner/issues/1193) |
| 3.4 | Component showcase page covering every component × state × theme | — | [#1193](https://github.com/kevinmcaleer/noodleplanner/issues/1193) |
| 3.5 | Storybook over the same component definitions | — | [#1197](https://github.com/kevinmcaleer/noodleplanner/issues/1197) |

**3.1 is the highest-priority item in the entire epic.** Everything else here
is consistency; this one is whether a keyboard user can see where they are.
It is also cheap — a single focus-ring token applied at a base rule level
covers most of it.

3.4 and 3.5 should share one source of truth. Two hand-maintained galleries
drift, and the second one to drift is the one nobody notices.

## Band 4 — Surfaces

The per-view rollout, ordered by the surface map in `ui-structure.json`:
30 project views, 9 portfolio views, 18 modals, 5 slide-in panels, 16 detail
forms, 3 wizard steps, 2 standalone forms.

| # | Item | Issue |
|---|---|---|
| 4.1 | Adopt spacing tokens per view, eyeballing each — **not** a find-and-replace, see the spacing audit | [#1194](https://github.com/kevinmcaleer/noodleplanner/issues/1194) |
| 4.2 | Migrate the 33 colour-carrying inline `style=""` attributes in the templates | [#1194](https://github.com/kevinmcaleer/noodleplanner/issues/1194) |
| 4.3 | Migrate static colour literals in JS-generated markup (214 lines, 22 files), leaving genuinely dynamic colour alone | [#1194](https://github.com/kevinmcaleer/noodleplanner/issues/1194) |
| 4.4 | Penpot screen audit board | [#1196](https://github.com/kevinmcaleer/noodleplanner/issues/1196) |

## Governance — runs alongside, from the end of band 1

| # | Item | Issue |
|---|---|---|
| G.1 | Linter for hardcoded colours and off-scale spacing, **warn-only** at first | [#1195](https://github.com/kevinmcaleer/noodleplanner/issues/1195) |
| G.2 | Allowlist for legitimate raw colour (canvas/chart APIs, runtime contrast calculation) | [#1195](https://github.com/kevinmcaleer/noodleplanner/issues/1195) |
| G.3 | Wire into CI; flip to failing once band 2 lands | [#1195](https://github.com/kevinmcaleer/noodleplanner/issues/1195) |
| G.4 | Contribution guidance: when to add a token vs. a component | [#1195](https://github.com/kevinmcaleer/noodleplanner/issues/1195) |

A linter that fails on day one against 2,671 pre-existing violations gets
switched off. Warn-only first, ratchet after band 2.

## Explicitly out of scope

- **`packages/obsidian-noodle-planner/styles/styles.css`** — a separate
  surface with its own host theme. It should get the same treatment
  eventually, but its tokens are Obsidian's, not NoodlePlanner's.
- **Vendored libraries** under `static/vendor/` — not ours to restyle.
- **Adopting the warm palette wholesale.** The audit found the app's real
  top-of-distribution greys are cool Bootstrap-era values that predate the
  warm system entirely. Whether they convert is a design decision with a
  visible result, and it wants a person looking at Penpot, not a refactor.
  Bands 1–2 deliberately leave it open.

## Two nav bugs found in passing

Neither is a design-system issue, both are real, and both were found by the
surface map:

- `lessons` is reachable from the nav but no group in `ALL_PROJECT_VIEWS`
  owns it, so `updatePlanSubnav` never marks the sub-nav active while it is
  open.
- `escalations` is listed in `TRACKING_VIEWS` but no `data-view` in the
  markup offers it.

## Convergence metric

The single number to watch. Re-run `npm run audit:tokens` after each band.

| Category | Baseline | After band 2 (predicted) | Token count |
|---|---|---|---|
| Colours | 586 | 377 | ~40 |
| Font sizes | 67 | 44 | ~10 |
| Radii | 32 | 26 | ~5 |
| Shadows | 105 | 66 | ~4 |
| Spacing values | 49 | 49 (band 4) | ~8 |

Band 2 alone does not get these near the token counts, and it is not supposed
to — it removes the duplicates so that band 4's judgement calls are made
against a clean list.
