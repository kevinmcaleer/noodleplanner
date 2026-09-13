#!/usr/bin/env node
// Renders the token-consolidation and ui-structure reports into a single
// browsable page, styled in NoodlePlanner's own Warm Paper / Marigold system
// so the explorer is itself an instance of the design system it audits.
//
// Usage:
//   node scripts/token-consolidation.mjs
//   node scripts/ui-structure-map.mjs
//   node scripts/design-system-explorer.mjs
// Writes docs/design/design-system-explorer.html.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))

const cons = read('docs/design/token-consolidation.json')
const ui = read('docs/design/ui-structure.json')

// Trim to what the page actually renders: the long tail of two-member
// clusters with a handful of uses isn't worth a reader's attention.
const payload = {
	thresholds: cons.thresholds,
	totals: cons.totals,
	savings: cons.savings,
	colorClusters: cons.colorClusters.filter((c) => c.totalUsage >= 4).slice(0, 60),
	fontSizeClusters: cons.fontSizeClusters,
	radiusClusters: cons.radiusClusters,
	shadowClusters: cons.shadowClusters.filter((c) => c.totalUsage >= 3),
	ui,
}

const DATA = JSON.stringify(payload).replace(/</g, '\\u003c')

const html = String.raw`<title>Marigold Drift</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;1,6..72,400&family=Instrument+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* Palette lifted from packages/noodle-web/src/noodle_web/static/visual-system.css --
   the layer that currently wins the cascade. */
:root {
  --paper:#FAF8F4; --surface:#FFFDF9; --sunken:#EFE9DE; --alt:#F3EEE5;
  --hairline:#E3DDD3; --hairline-soft:#EFE9DE;
  --ink:#23201C; --body:#5C5850; --faint:#736C60;
  --accent:#EDB52A; --accent-ink:#8A6205; --accent-tint:#FBEFCE; --accent-edge:#D9A31C;
  --danger-ink:#8C3A2C; --danger-tint:#F6E3E0;
  --shadow:0 1px 2px rgba(35,32,28,.04), 0 18px 40px -24px rgba(35,32,28,.22);
  --r-control:9px; --r-card:11px; --r-panel:14px;
  --swatch-ring:rgba(35,32,28,.18);
  --f-head:'Newsreader',Georgia,serif;
  --f-ui:'Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  --f-data:'IBM Plex Mono','DejaVu Sans Mono',monospace;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --paper:#201E1A; --surface:#292620; --sunken:#312D26; --alt:#312D26;
    --hairline:#51493D; --hairline-soft:#3A352E;
    --ink:#FAF8F4; --body:#D4CCBF; --faint:#B8AD9B;
    --accent:#EDB52A; --accent-ink:#F3C754; --accent-tint:#3A3021; --accent-edge:#D9A31C;
    --danger-ink:#E5A497; --danger-tint:#3E2B26;
    --shadow:0 1px 2px rgba(0,0,0,.3), 0 18px 40px -24px rgba(0,0,0,.7);
    --swatch-ring:rgba(250,248,244,.28);
  }
}
:root[data-theme="dark"]{
  --paper:#201E1A; --surface:#292620; --sunken:#312D26; --alt:#312D26;
  --hairline:#51493D; --hairline-soft:#3A352E;
  --ink:#FAF8F4; --body:#D4CCBF; --faint:#B8AD9B;
  --accent:#EDB52A; --accent-ink:#F3C754; --accent-tint:#3A3021; --accent-edge:#D9A31C;
  --danger-ink:#E5A497; --danger-tint:#3E2B26;
  --shadow:0 1px 2px rgba(0,0,0,.3), 0 18px 40px -24px rgba(0,0,0,.7);
  --swatch-ring:rgba(250,248,244,.28);
}

*{box-sizing:border-box}
body{
  background:var(--paper); color:var(--body);
  font-family:var(--f-ui); font-size:15px; line-height:1.55;
  margin:0; padding-block:40px; padding-inline:24px;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1060px;margin:0 auto;display:flex;flex-direction:column;gap:40px}

/* ---- masthead ---- */
.mast{display:flex;flex-direction:column;gap:14px}
.eyebrow{
  font-family:var(--f-data); font-size:11px; letter-spacing:.14em;
  text-transform:uppercase; color:var(--accent-ink);
}
h1{
  font-family:var(--f-head); font-weight:600; font-size:clamp(32px,5vw,46px);
  line-height:1.08; color:var(--ink); margin:0; text-wrap:balance;
  letter-spacing:-.01em;
}
.standfirst{max-width:64ch;margin:0;font-size:16.5px}
.standfirst em{font-style:italic;color:var(--ink)}
.regen{
  font-family:var(--f-data); font-size:12.5px; color:var(--faint);
  background:var(--sunken); border:1px solid var(--hairline-soft);
  border-radius:var(--r-control); padding:10px 14px;
  overflow-x:auto; white-space:pre;
}

/* ---- headline numbers ---- */
.ledger{
  border-top:2px solid var(--ink); border-bottom:1px solid var(--hairline);
  display:grid; grid-template-columns:repeat(4,1fr);
}
.ledger div{padding:16px 18px 18px;border-right:1px solid var(--hairline-soft)}
.ledger div:last-child{border-right:0}
.ledger dt{
  font-family:var(--f-data);font-size:10.5px;letter-spacing:.12em;
  text-transform:uppercase;color:var(--faint);margin:0 0 8px;
}
.ledger dd{margin:0;font-family:var(--f-head);font-size:26px;color:var(--ink);line-height:1;
  font-variant-numeric:tabular-nums}
.ledger dd s{text-decoration:line-through;color:var(--faint);font-size:19px;
  text-decoration-thickness:1.5px}
.ledger dd b{font-weight:600;color:var(--accent-ink)}
.ledger small{display:block;margin-top:7px;font-size:12px;color:var(--faint)}

/* ---- section scaffolding ---- */
section{display:flex;flex-direction:column;gap:18px}
h2{
  font-family:var(--f-head);font-weight:600;font-size:25px;color:var(--ink);
  margin:0;letter-spacing:-.005em;
}
.lede{margin:0;max-width:66ch;font-size:14.5px}

.tabs{display:flex;flex-wrap:wrap;gap:6px}
.tab{
  font:500 13px/1 var(--f-ui); color:var(--body); cursor:pointer;
  background:transparent; border:1px solid var(--hairline);
  border-radius:var(--r-control); padding:9px 14px;
}
.tab:hover{background:var(--sunken)}
.tab[aria-selected="true"]{background:var(--ink);border-color:var(--ink);color:var(--paper)}
.tab span{font-family:var(--f-data);font-size:11px;opacity:.62;margin-left:6px}
:focus-visible{outline:2px solid var(--accent-edge);outline-offset:2px}

/* ---- cluster rows ---- */
.clusters{display:flex;flex-direction:column;gap:0}
.cl{
  display:grid; grid-template-columns:216px 1fr; gap:24px;
  padding:20px 0; border-bottom:1px solid var(--hairline-soft);
}
.cl:first-child{border-top:1px solid var(--hairline)}

.verdict{display:flex;flex-direction:column;gap:9px;min-width:0}
.winner{display:flex;align-items:center;gap:10px}
/* Every swatch paints its colour over the same checkerboard, so a translucent
   value reads as translucent instead of vanishing into whichever theme is on. */
.sw{
  --c:transparent;
  background-color:#fff;
  background-image:linear-gradient(var(--c),var(--c)),
    linear-gradient(45deg,#d8d3ca 25%,transparent 25%,transparent 75%,#d8d3ca 75%),
    linear-gradient(45deg,#d8d3ca 25%,transparent 25%,transparent 75%,#d8d3ca 75%);
  background-size:100% 100%,9px 9px,9px 9px;
  background-position:0 0,0 0,4.5px 4.5px;
}
.chip{
  width:34px;height:34px;flex:none;border-radius:8px;
  box-shadow:inset 0 0 0 1px var(--swatch-ring);
}
.wval{font-family:var(--f-data);font-size:13.5px;color:var(--ink);word-break:break-all;line-height:1.3}
.wnote{font-size:12.5px;color:var(--faint);display:flex;align-items:baseline;gap:5px;flex-wrap:wrap}
.tok{
  font-family:var(--f-data);font-size:12px;color:var(--accent-ink);
  background:var(--accent-tint);border-radius:5px;padding:2px 7px;
  border:1px solid color-mix(in srgb,var(--accent) 34%,transparent);
}
.orphan{
  font-family:var(--f-data);font-size:12px;color:var(--danger-ink);
  background:var(--danger-tint);border-radius:5px;padding:2px 7px;
}

.evidence{display:flex;flex-direction:column;gap:11px;min-width:0}
/* Usage bar: width is share of the cluster's declarations, so the value that
   should win is the one that visibly owns the row. */
.bar{display:flex;height:32px;border-radius:7px;overflow:hidden;
  box-shadow:inset 0 0 0 1px var(--swatch-ring)}
.bar i{display:block;min-width:5px}
.bar i:first-child{position:relative}
.mem{display:flex;flex-wrap:wrap;gap:5px}
.m{
  display:inline-flex;align-items:center;gap:6px;
  font-family:var(--f-data);font-size:11.5px;color:var(--body);
  background:var(--surface);border:1px solid var(--hairline-soft);
  border-radius:6px;padding:3px 7px 3px 4px;
}
.m i{width:13px;height:13px;border-radius:3px;box-shadow:inset 0 0 0 1px var(--swatch-ring);flex:none}
.bar,.m i,.chip{position:relative}
.m b{font-weight:500;color:var(--ink);font-variant-numeric:tabular-nums}
.m u{text-decoration:none;color:var(--faint);font-size:10.5px}
.m.lead{border-color:var(--accent);background:var(--accent-tint)}

/* previews for the non-colour categories */
.prev{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end}
.pv{display:flex;flex-direction:column;align-items:center;gap:7px}
.pv .box{width:56px;height:40px;background:var(--surface);border:1px solid var(--hairline)}
.pv .box.sh{border:0;background:var(--surface)}
.pv .t{background:var(--surface);border:1px solid var(--hairline);border-radius:6px;
  padding:5px 9px;color:var(--ink);white-space:nowrap}
.pv .cap{font-family:var(--f-data);font-size:10.5px;color:var(--faint);
  font-variant-numeric:tabular-nums}

/* ---- surface map ---- */
.map{display:grid;grid-template-columns:repeat(auto-fit,minmax(238px,1fr));gap:16px}
.grp{background:var(--surface);border:1px solid var(--hairline);border-radius:var(--r-card);
  padding:16px 17px;display:flex;flex-direction:column;gap:11px}
.grp.lift{box-shadow:var(--shadow)}
.grp h3{
  margin:0;font:500 11px/1 var(--f-data);letter-spacing:.12em;text-transform:uppercase;
  color:var(--faint);display:flex;justify-content:space-between;align-items:baseline;gap:8px;
}
.grp h3 b{font-family:var(--f-head);font-size:17px;color:var(--ink);letter-spacing:0;font-weight:600}
.grp ul{margin:0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:5px}
.grp li{
  font-family:var(--f-data);font-size:11.5px;color:var(--body);
  background:var(--sunken);border-radius:5px;padding:3px 8px;
}
.grp.accent{border-color:var(--accent);border-left-width:3px}
.grp.accent li{background:var(--accent-tint);color:var(--accent-ink)}

.flag{
  display:flex;gap:11px;align-items:flex-start;
  background:var(--danger-tint);border-radius:var(--r-control);
  padding:13px 15px;font-size:13.5px;color:var(--ink);
}
.flag code{font-family:var(--f-data);font-size:12.5px;background:var(--surface);
  padding:1px 5px;border-radius:4px}
.flag b{font-family:var(--f-data);font-size:11px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--danger-ink);flex:none;padding-top:2px}

footer{border-top:1px solid var(--hairline);padding-top:18px;font-size:13px;color:var(--faint)}
footer code{font-family:var(--f-data);font-size:12px}

@media (max-width:720px){
  .ledger{grid-template-columns:repeat(2,1fr)}
  .ledger div:nth-child(2){border-right:0}
  .ledger div:nth-child(-n+2){border-bottom:1px solid var(--hairline-soft)}
  .cl{grid-template-columns:1fr;gap:14px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style>

<div class="wrap">
  <header class="mast">
    <div class="eyebrow">NoodlePlanner &middot; CSS standardisation</div>
    <h1>Where the palette drifted</h1>
    <p class="standfirst">The token audit counted the values. This one clusters them: every
      raw colour, size, radius and shadow in the stylesheet grouped with its
      near-identical twins, so you can see <em>which duplicates collapse into one
      token</em> and which member deserves to be it.</p>
    <div class="regen">npm run audit:tokens &amp;&amp; npm run design</div>
  </header>

  <dl class="ledger" id="ledger"></dl>

  <section>
    <h2>Merge candidates</h2>
    <p class="lede">Each row is one cluster of values a person could not tell apart.
      The bar shows how the cluster's declarations split between its members — the
      value that already owns the row is usually the one to keep. Colour clusters
      used fewer than four times are left out here; all of them are in the JSON.</p>
    <div class="tabs" role="tablist" id="tabs"></div>
    <div class="clusters" id="clusters"></div>
  </section>

  <section>
    <h2>Surface map</h2>
    <p class="lede">Every addressable surface in <code>index.html</code>, read from the
      nav constants in <code>state.js</code> rather than a hand-drawn diagram — so it
      stays true as the app changes.</p>
    <div id="flags"></div>
    <div class="map" id="map"></div>
  </section>

  <footer>
    Generated from <code>docs/design/token-consolidation.json</code> and
    <code>docs/design/ui-structure.json</code>. Colours cluster at CIEDE2000
    &Delta;E &le; <span id="de"></span> (&le; <span id="nde"></span> for neutrals,
    which sit closer together by design).
  </footer>
</div>

<script id="data" type="application/json">${DATA}</script>
<script>
const D = JSON.parse(document.getElementById('data').textContent);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };

document.getElementById('de').textContent = D.thresholds.colorDeltaE2000;
document.getElementById('nde').textContent = D.thresholds.neutralDeltaE2000;

/* ---- ledger ---- */
const LEDGER = [
  ['Colours', D.totals.colors, D.savings.colors],
  ['Font sizes', D.totals.fontSizes, D.savings.fontSizes],
  ['Radii', D.totals.radii, D.savings.radii],
  ['Shadows', D.totals.boxShadows, D.savings.boxShadows],
];
const ledger = document.getElementById('ledger');
for (const [name, total, s] of LEDGER) {
  const d = el('div');
  d.append(el('dt', null, name));
  const dd = el('dd');
  dd.append(el('s', null, total), document.createTextNode(' '), el('b', null, String(total - s.valuesRemovable)));
  d.append(dd, el('small', null, s.clusters + ' clusters · ' + s.declarationsTouched.toLocaleString() + ' declarations'));
  ledger.append(d);
}

/* ---- merge candidates ---- */
const CATS = [
  { key: 'colorClusters', label: 'Colour' },
  { key: 'fontSizeClusters', label: 'Font size' },
  { key: 'radiusClusters', label: 'Radius' },
  { key: 'shadowClusters', label: 'Shadow' },
];
const tabs = document.getElementById('tabs');
const host = document.getElementById('clusters');

function swatch(node, m) {
  // authoredAs is valid CSS by construction -- it came out of the stylesheet.
  node.classList.add('sw');
  node.style.setProperty('--c', m.alpha === 0 ? 'transparent' : (m.authoredAs || m.hex));
  return node;
}

function colourRow(c) {
  const row = el('div', 'cl');
  const v = el('div', 'verdict');
  const w = el('div', 'winner');
  w.append(swatch(el('span', 'chip'), c.members[0]), el('span', 'wval', c.recommendation));
  v.append(w);
  const note = el('div', 'wnote');
  if (c.existingToken) {
    note.append(document.createTextNode('matches'), el('span', 'tok', c.existingToken.name));
    note.append(el('span', null, 'ΔE ' + c.existingToken.deltaE));
  } else {
    note.append(el('span', 'orphan', 'no token covers this'));
  }
  note.append(el('span', null, c.memberCount + ' values · ' + c.totalUsage + ' uses'));
  v.append(note);

  const ev = el('div', 'evidence');
  const bar = el('div', 'bar');
  for (const m of c.members) {
    const seg = swatch(el('i'), m);
    seg.style.flex = m.usage + ' 1 0';
    seg.title = m.authoredAs + ' — ' + m.usage + ' uses';
    bar.append(seg);
  }
  ev.append(bar);
  const mem = el('div', 'mem');
  c.members.forEach((m, i) => {
    const chip = el('span', 'm' + (i === 0 ? ' lead' : ''));
    chip.append(swatch(el('i'), m), el('span', null, m.authoredAs), el('b', null, '×' + m.usage));
    if (m.deltaE > 0) chip.append(el('u', null, 'ΔE' + m.deltaE));
    mem.append(chip);
  });
  ev.append(mem);
  row.append(v, ev);
  return row;
}

function valueRow(c, render) {
  const row = el('div', 'cl');
  const v = el('div', 'verdict');
  v.append(el('div', 'wval', c.recommendation));
  const note = el('div', 'wnote');
  note.append(el('span', null, c.memberCount + ' values · ' + c.totalUsage + ' uses'));
  v.append(note);
  const ev = el('div', 'evidence');
  const bar = el('div', 'bar');
  c.members.forEach((m, i) => {
    const seg = el('i');
    seg.style.flex = m.usage + ' 1 0';
    seg.style.background = i === 0 ? 'var(--accent)' : 'var(--sunken)';
    seg.title = m.authoredAs + ' — ' + m.usage + ' uses';
    bar.append(seg);
  });
  ev.append(bar, render(c));
  row.append(v, ev);
  return row;
}

const preview = (mk) => (c) => {
  const p = el('div', 'prev');
  for (const m of c.members) {
    const cell = el('div', 'pv');
    cell.append(mk(m), el('span', 'cap', m.authoredAs + ' ×' + m.usage));
    p.append(cell);
  }
  return p;
};

const fontPreview = preview((m) => {
  const t = el('span', 't', 'Aa Task 24');
  t.style.fontSize = m.authoredAs;
  return t;
});
const radiusPreview = preview((m) => {
  const b = el('div', 'box');
  b.style.borderRadius = m.authoredAs;
  return b;
});
const shadowPreview = preview((m) => {
  const b = el('div', 'box sh');
  b.style.boxShadow = m.authoredAs;
  b.style.borderRadius = '8px';
  return b;
});

const RENDER = {
  colorClusters: colourRow,
  fontSizeClusters: (c) => valueRow(c, fontPreview),
  radiusClusters: (c) => valueRow(c, radiusPreview),
  shadowClusters: (c) => valueRow(c, shadowPreview),
};

function show(key) {
  host.replaceChildren(...D[key].map(RENDER[key]));
  for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.k === key));
}
for (const { key, label } of CATS) {
  const b = el('button', 'tab');
  b.type = 'button';
  b.setAttribute('role', 'tab');
  b.dataset.k = key;
  b.append(document.createTextNode(label), el('span', null, D[key].length));
  b.onclick = () => show(key);
  tabs.append(b);
}
show('colorClusters');

/* ---- surface map ---- */
const flags = document.getElementById('flags');
for (const [views, msg] of [
  [D.ui.viewsWiredInNavButNotGrouped, 'reachable from the nav, but no view group in state.js owns it — so the sub-nav never highlights while it is open'],
  [D.ui.viewsGroupedButNotWiredInNav, 'listed in a view group, but nothing in the nav markup offers it'],
]) {
  if (!views.length) continue;
  const f = el('div', 'flag');
  f.append(el('b', null, 'IA gap'));
  const p = el('div');
  views.forEach((v, i) => { if (i) p.append(document.createTextNode(', ')); p.append(el('code', null, v)); });
  p.append(document.createTextNode(' is ' + msg + '.'));
  f.append(p);
  flags.append(f);
}

const map = document.getElementById('map');
function group(title, items, opts = {}) {
  const g = el('div', 'grp' + (opts.accent ? ' accent' : '') + (opts.lift ? ' lift' : ''));
  const h = el('h3');
  h.append(el('b', null, title), el('span', null, String(items.length)));
  g.append(h);
  const ul = el('ul');
  for (const it of items) ul.append(el('li', null, it));
  g.append(ul);
  map.append(g);
}
group('Shells', D.ui.shells, { lift: true });
for (const [name, views] of Object.entries(D.ui.viewGroups)) group(name + ' views', views);
group('Portfolio views', D.ui.portfolioViews);
const S = D.ui.surfaces;
const labels = (a) => a.map((s) => s.label);
group('Slide-in panels', labels(S.slideIns), { accent: true });
group('Detail forms', labels(S.detailForms), { accent: true });
group('Modal overlays', labels(S.overlays), { accent: true });
if (S.wizardSteps.length) group('Wizard steps', labels(S.wizardSteps));
if (S.forms.length) group('Standalone forms', labels(S.forms));
</script>
`

writeFileSync(join(ROOT, 'docs/design/design-system-explorer.html'), html)
console.log('Wrote docs/design/design-system-explorer.html')
