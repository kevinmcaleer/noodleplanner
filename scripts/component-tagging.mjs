#!/usr/bin/env node
// UI inventory, pass 2: component tagging.
//
// Pass 1 (scripts/ui-structure-map.mjs) named every screen. This pass tags
// which component families appear on each one and tallies how many screens
// each family reaches -- the frequency count design-system.md's ordering
// depends on: build the most-used component first.
//
// Method, mechanical rather than hand-curated:
//   - Project and portfolio views resolve to a container id the app's own
//     router uses (`${view}-view`/`${view}-tab` from NavigationController in
//     script.js; `portfolio${View}View` from portfolio.js's switch). The
//     container's real HTML is extracted with a depth-balanced tag scan, not
//     a fixed character window, so nested markup of the same tag name is
//     handled correctly.
//   - Portfolio views (and any other screen whose container is a JS-filled
//     shell) get a second pass: every static/*.js file that mentions the
//     container id contributes a windowed excerpt around each mention,
//     rather than the whole file, so a container id every view happens to
//     share with script.js doesn't drag that view's tally toward "contains
//     everything".
//   - Component families are the same seven token-audit.mjs already
//     established (button, badge, input, card, modal, table, nav), matched
//     the same way: hyphen/underscore-separated class-name segments against
//     each family's word set, not a substring match.
//
// Usage: node scripts/component-tagging.mjs
// Requires docs/design/ui-structure.json (npm run design:map) to be current.
// Writes docs/design/component-tagging.json.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const WEB = join(ROOT, 'packages/noodle-web/src/noodle_web')
const INDEX = join(WEB, 'templates/index.html')
const STATIC_DIR = join(WEB, 'static')
const STRUCTURE_PATH = join(ROOT, 'docs/design/ui-structure.json')

const html = readFileSync(INDEX, 'utf8')
let structure
try {
	structure = JSON.parse(readFileSync(STRUCTURE_PATH, 'utf8'))
} catch {
	console.error('Missing or unreadable docs/design/ui-structure.json -- run `npm run design:map` first.')
	process.exit(1)
}

const jsFiles = readdirSync(STATIC_DIR)
	.filter((f) => f.endsWith('.js'))
	.map((f) => ({ name: f, text: readFileSync(join(STATIC_DIR, f), 'utf8') }))

// Same taxonomy as scripts/token-audit.mjs's COMPONENT_FAMILIES, so a screen
// count here means the same thing as a rule count there.
const COMPONENT_FAMILIES = [
	['button', ['btn', 'btns', 'button', 'buttons']],
	['badge', ['badge', 'badges', 'chip', 'chips', 'pill', 'pills', 'tag', 'tags', 'label']],
	['input', ['input', 'inputs', 'field', 'fields', 'select', 'textarea', 'checkbox', 'radio', 'form', 'control']],
	['card', ['card', 'cards', 'tile', 'tiles', 'panel', 'panels']],
	['modal', ['modal', 'modals', 'dialog', 'popover', 'dropdown', 'tooltip', 'menu', 'overlay', 'drawer']],
	['table', ['table', 'tables', 'grid', 'row', 'rows', 'cell', 'cells', 'col', 'cols', 'column', 'columns', 'th', 'td']],
	['nav', ['nav', 'navbar', 'tab', 'tabs', 'ribbon', 'toolbar', 'sidebar', 'breadcrumb', 'crumb']],
].map(([name, words]) => [name, new Set(words)])

// ---------------------------------------------------------------------------
// Depth-balanced element extraction by id -- attribute-quote aware, so a `>`
// inside an onclick handler's comparison doesn't end the tag early.
// ---------------------------------------------------------------------------
function findTagEnd(text, ltPos) {
	let i = ltPos + 1
	let quote = null
	while (i < text.length) {
		const c = text[i]
		if (quote) {
			if (c === quote) quote = null
		} else if (c === '"' || c === "'") {
			quote = c
		} else if (c === '>') {
			return i
		}
		i++
	}
	return -1
}

function findOpenTagById(text, id) {
	const re = /<([a-zA-Z][a-zA-Z0-9]*)\b/g
	let m
	while ((m = re.exec(text))) {
		const closeIdx = findTagEnd(text, m.index)
		if (closeIdx === -1) break
		const attrText = text.slice(m.index, closeIdx + 1)
		const idMatch = attrText.match(/\sid=["']([^"']+)["']/)
		if (idMatch && idMatch[1] === id) {
			return { tag: m[1].toLowerCase(), start: m.index, openEnd: closeIdx + 1 }
		}
		re.lastIndex = closeIdx + 1
	}
	return null
}

function extractBalanced(text, tag, start, openEnd) {
	const openRe = new RegExp(`<${tag}\\b`, 'gi')
	const closeRe = new RegExp(`</${tag}\\s*>`, 'gi')
	let depth = 1
	let i = openEnd
	while (depth > 0 && i < text.length) {
		openRe.lastIndex = i
		closeRe.lastIndex = i
		const om = openRe.exec(text)
		const cm = closeRe.exec(text)
		if (!cm) return text.slice(start, text.length)
		if (om && om.index < cm.index) {
			depth++
			i = om.index + om[0].length
		} else {
			depth--
			i = cm.index + cm[0].length
		}
	}
	return text.slice(start, i)
}

// Windowed excerpts around each mention of `needle`, merged where windows
// overlap -- so a container id mentioned once in a 17,000-line file pulls in
// a few thousand characters of the surrounding render function, not the
// whole file.
function excerptsAround(text, needle, before = 800, after = 2500) {
	const idxs = []
	let idx = text.indexOf(needle)
	while (idx !== -1) {
		idxs.push(idx)
		idx = text.indexOf(needle, idx + needle.length)
	}
	if (!idxs.length) return ''
	const windows = idxs
		.map((i) => [Math.max(0, i - before), Math.min(text.length, i + needle.length + after)])
		.sort((a, b) => a[0] - b[0])
	const merged = [windows[0]]
	for (const w of windows.slice(1)) {
		const last = merged[merged.length - 1]
		if (w[0] <= last[1]) last[1] = Math.max(last[1], w[1])
		else merged.push(w)
	}
	return merged.map(([s, e]) => text.slice(s, e)).join('\n')
}

// ---------------------------------------------------------------------------
// Family tagging over a blob of markup/JS.
// ---------------------------------------------------------------------------
function scanFamilies(text) {
	const classAttrs = [...text.matchAll(/class(?:Name)?\s*=\s*["']([^"']{0,200})["']/g)].map((m) => m[1])
	const classListArgs = [...text.matchAll(/classList\.(?:add|toggle|remove)\(([^)]{0,200})\)/g)].map((m) => m[1])
	const classListTokens = classListArgs.flatMap((args) => [...args.matchAll(/['"]([a-zA-Z0-9_-]+)['"]/g)].map((m) => m[1]))
	const tokens = classAttrs.flatMap((s) => s.split(/\s+/)).concat(classListTokens).filter(Boolean)

	const found = new Map() // family -> Set(className)
	for (const cls of tokens) {
		const segments = cls.toLowerCase().split(/[-_]/).filter(Boolean)
		for (const [family, words] of COMPONENT_FAMILIES) {
			if (segments.some((seg) => words.has(seg))) {
				if (!found.has(family)) found.set(family, new Set())
				found.get(family).add(cls)
			}
		}
	}
	return found
}

// ---------------------------------------------------------------------------
// Build the screen list from pass 1's output, then tag each one.
// ---------------------------------------------------------------------------
const screens = []

function addScreen(name, group, kind, containerId) {
	const open = findOpenTagById(html, containerId)
	let text = open ? extractBalanced(html, open.tag, open.start, open.openEnd) : ''
	for (const f of jsFiles) {
		if (f.text.includes(containerId)) text += '\n' + excerptsAround(f.text, containerId)
	}
	const families = scanFamilies(text)
	screens.push({
		name,
		group,
		kind,
		containerId,
		foundStatic: !!open,
		families: [...families.keys()].sort(),
		classNames: Object.fromEntries([...families.entries()].map(([k, v]) => [k, [...v].sort()])),
	})
}

for (const [group, views] of Object.entries(structure.viewGroups)) {
	for (const view of views) {
		const candidates = [`${view}-view`, `${view}-tab`]
		const containerId = candidates.find((c) => html.includes(`id="${c}"`)) ?? candidates[0]
		addScreen(view, group, 'project-view', containerId)
	}
}

for (const view of structure.portfolioViews) {
	addScreen(view, 'Portfolio', 'portfolio-view', `portfolio${view}View`)
}

for (const [key, kind] of [
	['slideIns', 'slide-in'],
	['detailForms', 'detail-form'],
	['overlays', 'overlay'],
	['modals', 'modal'],
	['wizardSteps', 'wizard-step'],
	['forms', 'form'],
	['panels', 'panel'],
]) {
	for (const s of structure.surfaces[key] ?? []) {
		addScreen(s.label, 'Surface', kind, s.id)
	}
}

// ---------------------------------------------------------------------------
// Aggregate: the frequency tally the build order depends on.
// ---------------------------------------------------------------------------
const familyScreenCount = new Map()
const familyClassScreens = new Map() // family -> Map(className -> Set(screenName))
for (const s of screens) {
	for (const fam of s.families) familyScreenCount.set(fam, (familyScreenCount.get(fam) ?? 0) + 1)
	for (const [fam, classes] of Object.entries(s.classNames)) {
		if (!familyClassScreens.has(fam)) familyClassScreens.set(fam, new Map())
		const m = familyClassScreens.get(fam)
		for (const cls of classes) {
			if (!m.has(cls)) m.set(cls, new Set())
			m.get(cls).add(s.name)
		}
	}
}

const familySummary = [...familyScreenCount.entries()]
	.sort((a, b) => b[1] - a[1])
	.map(([family, screenCount]) => ({
		family,
		screenCount,
		screenPct: Math.round((screenCount / screens.length) * 1000) / 10,
		distinctClassNames: familyClassScreens.get(family)?.size ?? 0,
		topClassNames: [...(familyClassScreens.get(family) ?? new Map()).entries()]
			.sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
			.slice(0, 12)
			.map(([name, set]) => ({ name, screens: set.size })),
	}))

const notFound = screens.filter((s) => !s.foundStatic)

const report = {
	method: 'scripts/component-tagging.mjs -- see the file header for the extraction method',
	generatedFrom: {
		structure: 'docs/design/ui-structure.json',
		template: 'packages/noodle-web/src/noodle_web/templates/index.html',
		scripts: 'packages/noodle-web/src/noodle_web/static/*.js',
	},
	screenCount: screens.length,
	families: familySummary,
	screensWithNoStaticContainer: notFound.map((s) => ({ name: s.name, containerId: s.containerId })),
	screens: screens.map(({ name, group, kind, containerId, foundStatic, families }) => ({
		name,
		group,
		kind,
		containerId,
		foundStatic,
		families,
	})),
}

writeFileSync(join(ROOT, 'docs/design/component-tagging.json'), JSON.stringify(report, null, '\t') + '\n')

console.log(`Tagged ${screens.length} screens (${notFound.length} with no static container found).`)
console.table(familySummary.map(({ family, screenCount, screenPct, distinctClassNames }) => ({ family, screenCount, screenPct, distinctClassNames })))
