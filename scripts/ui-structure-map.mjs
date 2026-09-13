#!/usr/bin/env node
// UI structure map for the NoodlePlanner web app.
//
// Extracts the app's visual structure -- shells, views, slide-in overlays,
// modals and detail forms -- straight from the source of truth rather than a
// hand-maintained diagram:
//
//   static/state.js   -> PLAN_VIEWS / TRACKING_VIEWS / RESOURCES_VIEWS, the
//                        authoritative grouping the nav actually switches on
//   templates/index.html -> the overlay, panel and form elements themselves
//
// Usage: node scripts/ui-structure-map.mjs
// Writes docs/design/ui-structure.json and penpot/noodleplanner-ui-structure.mmd.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const WEB = join(ROOT, 'packages/noodle-web/src/noodle_web')
const INDEX = join(WEB, 'templates/index.html')
const STATE = join(WEB, 'static/state.js')

const html = readFileSync(INDEX, 'utf8')
const state = readFileSync(STATE, 'utf8')

// ---------------------------------------------------------------------------
// 1. View groups, read out of state.js's navigation constants.
// ---------------------------------------------------------------------------
function viewList(name) {
	const m = state.match(new RegExp(`const ${name}\\s*=\\s*\\[([^\\]]*)\\]`))
	if (!m) return []
	return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

const groups = {
	Plan: viewList('PLAN_VIEWS'),
	Tracking: viewList('TRACKING_VIEWS'),
	Resources: viewList('RESOURCES_VIEWS'),
}

// Views the nav can reach, cross-checked against the markup that offers them.
const wiredViews = new Set([...html.matchAll(/data-view="([^"]+)"/g)].map((m) => m[1]))
const declaredViews = new Set(Object.values(groups).flat())

// ---------------------------------------------------------------------------
// 2. Element scan of index.html.
//
// A tolerant tag scanner rather than a DOM parse: index.html is a single
// 4.8k-line hand-authored template, and we only need each element's id, class
// and the first heading-ish text inside it.
// ---------------------------------------------------------------------------
const TAG = /<(div|section|aside|form|dialog)\b([^>]*)>/gi

function attr(attrs, name) {
	const m = attrs.match(new RegExp(`${name}="([^"]*)"`, 'i'))
	return m ? m[1] : ''
}

// Kebab-normalise a camelCase id so `collabPresencePanel` and
// `collab-presence-panel` classify identically.
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

// Fragments of a surface, not surfaces in their own right.
const FRAGMENT = /(header|body|footer|title|actions|content|wrapper|inner|indicator)$/i

const MARKER = [
	// [kind, matcher] -- ordered most specific first.
	['detail-form', /detail-pane-section/],
	['slide-in', /detail-pane$|(^|[\s-])(fm|front-matter|ai-chat|kanban-editor|collab-presence)-panel|inspector-pane|drawer|flyout/],
	['overlay', /modal-overlay|(^|-)overlay$|-overlay(-|$)/],
	['wizard-step', /wizard-panel|wizard-step/],
	['modal', /(^|-)modal$|-modal(-|$)|(^|-)dialog$/],
	['form', /(^|-)form$/],
	['panel', /(^|-)panel$/],
]

const raw = []
let m
while ((m = TAG.exec(html))) {
	const [full, tag, attrs] = m
	const id = attr(attrs, 'id')
	if (!id) continue // unnamed wrappers aren't addressable surfaces
	const cls = attr(attrs, 'class')
	const kid = kebab(id)
	if (FRAGMENT.test(kid)) continue

	const hay = `${kid} ${cls}`
	let kind = null
	for (const [k, re] of MARKER) {
		if (re.test(hay)) { kind = k; break }
	}
	if (!kind && tag.toLowerCase() === 'form') kind = 'form'
	if (!kind) continue
	if (raw.some((s) => s.id === id)) continue

	raw.push({
		id,
		kind,
		tag: tag.toLowerCase(),
		classes: cls.split(/\s+/).filter(Boolean).slice(0, 4),
		at: m.index + full.length,
	})
}

// Labels in a second pass: a surface's own heading is whatever comes before
// the NEXT surface starts. Looking a fixed number of characters ahead instead
// reaches past the element's own markup and mislabels it with its neighbour's
// title -- which is exactly what a first cut of this script did.
const surfaces = raw.map((s, i) => {
	const until = i + 1 < raw.length ? raw[i + 1].at : Math.min(s.at + 2000, html.length)
	const slice = html.slice(s.at, until)
	const h = slice.match(
		/<(?:h[1-6]|legend)[^>]*>([^<]{2,60})<|class="[^"]*(?:modal-title|detail-pane-title|panel-title)[^"]*"[^>]*>([^<]{2,60})</i
	)
	const text = h && (h[1] || h[2])
	const clean = text ? text.replace(/\s+/g, ' ').trim() : ''
	const label =
		clean && !/^[{<]/.test(clean)
			? clean
			: s.id
					.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
					.replace(/[-_]+/g, ' ')
					.replace(/\b\w/g, (c) => c.toUpperCase())
					.trim()
	return { id: s.id, kind: s.kind, tag: s.tag, classes: s.classes, label }
})

// Portfolio sub-views follow their own naming convention.
const portfolioViews = [...html.matchAll(/id="portfolio(\w+)View"/g)]
	.map((x) => x[1])
	.filter((v, i, a) => a.indexOf(v) === i)

const byKind = (k) => surfaces.filter((s) => s.kind === k).sort((a, b) => a.id.localeCompare(b.id))

const report = {
	source: {
		template: 'packages/noodle-web/src/noodle_web/templates/index.html',
		navConstants: 'packages/noodle-web/src/noodle_web/static/state.js',
	},
	shells: ['backstage', 'search', 'portfolio', 'programme', 'upload', 'editor'],
	viewGroups: groups,
	portfolioViews,
	viewsWiredInNavButNotGrouped: [...wiredViews].filter((v) => !declaredViews.has(v)).sort(),
	viewsGroupedButNotWiredInNav: [...declaredViews].filter((v) => !wiredViews.has(v)).sort(),
	surfaces: {
		slideIns: byKind('slide-in'),
		detailForms: byKind('detail-form'),
		overlays: byKind('overlay'),
		modals: byKind('modal'),
		wizardSteps: byKind('wizard-step'),
		forms: byKind('form'),
		panels: byKind('panel'),
	},
	counts: {
		projectViews: declaredViews.size,
		portfolioViews: portfolioViews.length,
		slideIns: byKind('slide-in').length,
		detailForms: byKind('detail-form').length,
		overlays: byKind('overlay').length,
		modals: byKind('modal').length,
		wizardSteps: byKind('wizard-step').length,
		forms: byKind('form').length,
		panels: byKind('panel').length,
	},
}

mkdirSync(join(ROOT, 'docs/design'), { recursive: true })
writeFileSync(join(ROOT, 'docs/design/ui-structure.json'), JSON.stringify(report, null, '\t') + '\n')

// ---------------------------------------------------------------------------
// 3. Mermaid rendering, for Penpot / docs / GitHub.
// ---------------------------------------------------------------------------
const safe = (s) => s.replace(/[^a-zA-Z0-9]/g, '_')
const esc = (s) => s.replace(/"/g, "'")
const lines = []
lines.push('%% Generated by scripts/ui-structure-map.mjs -- do not edit by hand')
lines.push('graph LR')
lines.push('  Root["/ (index.html)"]')
for (const shell of report.shells) lines.push(`  Root --> S_${safe(shell)}["${shell}"]`)

for (const [group, views] of Object.entries(groups)) {
	if (!views.length) continue
	lines.push(`  subgraph G_${safe(group)}["${group} views"]`)
	for (const v of views) lines.push(`    V_${safe(v)}["${v}"]`)
	lines.push('  end')
	lines.push(`  S_editor --> G_${safe(group)}`)
}

lines.push('  subgraph G_portfolio["Portfolio views"]')
for (const v of portfolioViews) lines.push(`    PV_${safe(v)}["${v}"]`)
lines.push('  end')
lines.push('  S_portfolio --> G_portfolio')

for (const [title, key] of [
	['Slide-in panels', 'slideIns'],
	['Detail forms (in the detail pane)', 'detailForms'],
	['Modal overlays', 'overlays'],
	['Wizard steps', 'wizardSteps'],
	['Standalone forms', 'forms'],
	['Other panels', 'panels'],
]) {
	const items = report.surfaces[key]
	if (!items.length) continue
	lines.push(`  subgraph G_${safe(key)}["${title} (${items.length})"]`)
	for (const s of items) lines.push(`    ${safe(key)}_${safe(s.id)}["${esc(s.label)}"]`)
	lines.push('  end')
	lines.push(`  Root -.-> G_${safe(key)}`)
}

mkdirSync(join(ROOT, 'penpot'), { recursive: true })
writeFileSync(join(ROOT, 'penpot/noodleplanner-ui-structure.mmd'), lines.join('\n') + '\n')

console.log('Wrote docs/design/ui-structure.json and penpot/noodleplanner-ui-structure.mmd')
console.table(report.counts)
if (report.viewsWiredInNavButNotGrouped.length)
	console.log('nav offers but no group owns:', report.viewsWiredInNavButNotGrouped.join(', '))
if (report.viewsGroupedButNotWiredInNav.length)
	console.log('grouped but nav never offers:', report.viewsGroupedButNotWiredInNav.join(', '))
