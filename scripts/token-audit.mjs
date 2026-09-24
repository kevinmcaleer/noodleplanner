#!/usr/bin/env node
// Token audit for the NoodlePlanner web app, built on Project Wallace's
// CSS tooling (@projectwallace/css-analyzer + @projectwallace/css-design-tokens).
//
// Scans packages/noodle-web/src/noodle_web/static for:
//   - the canonical --np-* design tokens declared in visual-system.css
//     (light + dark values), to recognise raw values that duplicate one
//   - raw/one-off values elsewhere in the CSS that duplicate or compete
//     with those tokens, plus general CSS-health metrics
//
// It used to export the tokens to docs/design/tokens/*.json as well. That
// direction is reversed (#1318): the JSON is Penpot's export and the source,
// and scripts/design-tokens.mjs generates the CSS from it.
//
// Usage: node scripts/token-audit.mjs
// Writes docs/design/token-audit-data.json and prints the same JSON summary,
// used to regenerate docs/design/token-audit.md's data tables by hand.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { analyze } from '@projectwallace/css-analyzer'
import { analysis_to_tokens } from '@projectwallace/css-design-tokens'

const ROOT = new URL('..', import.meta.url).pathname
const STATIC_DIR = join(ROOT, 'packages/noodle-web/src/noodle_web/static')
const VISUAL_SYSTEM = join(STATIC_DIR, 'visual-system.css')
const OUT_DIR = join(ROOT, 'docs/design')

function walkFiles(dir, ext) {
	const out = []
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry)
		const stats = statSync(full)
		if (stats.isDirectory()) {
			out.push(...walkFiles(full, ext))
		} else if (entry.endsWith(ext)) {
			out.push(full)
		}
	}
	return out
}

function walkCssFiles(dir) {
	return walkFiles(dir, '.css')
}

// --- Minimal brace-depth CSS parser, used only to pull top-level custom
// property declarations (with their selector list) out of visual-system.css.
// Good enough for hand-authored, non-nested CSS; not a general parser.
function parseTopLevelRules(css) {
	css = css.replace(/\/\*[\s\S]*?\*\//g, '')
	const rules = []
	let i = 0
	const n = css.length

	function skipAtRuleBlock() {
		// consumes a balanced {...} block, recursing into nested rules
		// (e.g. @media { .a { ... } }) and collecting the inner rules too.
		let depth = 1
		let buf = ''
		while (i < n && depth > 0) {
			const c = css[i]
			if (c === '{') {
				const prelude = buf.trim()
				buf = ''
				i++
				depth++
				if (prelude && !prelude.startsWith('@')) {
					const bodyStart = i
					let innerDepth = 1
					while (i < n && innerDepth > 0) {
						if (css[i] === '{') innerDepth++
						else if (css[i] === '}') innerDepth--
						if (innerDepth > 0) i++
					}
					rules.push({ selector: prelude, body: css.slice(bodyStart, i) })
					i++ // consume closing }
					depth--
				}
				continue
			}
			if (c === '}') {
				depth--
				i++
				continue
			}
			buf += c
			i++
		}
	}

	let buf = ''
	while (i < n) {
		const c = css[i]
		if (c === '{') {
			const prelude = buf.trim()
			buf = ''
			i++
			if (prelude.startsWith('@')) {
				skipAtRuleBlock()
			} else {
				const bodyStart = i
				let depth = 1
				while (i < n && depth > 0) {
					if (css[i] === '{') depth++
					else if (css[i] === '}') depth--
					if (depth > 0) i++
				}
				rules.push({ selector: prelude, body: css.slice(bodyStart, i) })
				i++
			}
			continue
		}
		if (c === ';' && buf.trim().startsWith('@')) {
			buf = ''
			i++
			continue
		}
		buf += c
		i++
	}
	return rules
}

function parseDeclarations(body) {
	const decls = []
	for (const raw of body.split(';')) {
		const s = raw.trim()
		if (!s) continue
		const idx = s.indexOf(':')
		if (idx === -1) continue
		const prop = s.slice(0, idx).trim()
		const value = s.slice(idx + 1).trim()
		if (prop) decls.push({ prop, value })
	}
	return decls
}

function isDarkSelector(selector) {
	return /\[data-theme=["']?dark["']?\]/.test(selector)
}

function isRootSelector(selector) {
	return selector.split(',').some((s) => s.trim() === ':root')
}

// --- 1. Canonical tokens: parse visual-system.css into light/dark maps,
// resolving var(--np-x) aliases against already-resolved values.
function extractCanonicalTokens() {
	const css = readFileSync(VISUAL_SYSTEM, 'utf8')
	const rules = parseTopLevelRules(css)

	const light = {}
	const dark = {}

	for (const { selector, body } of rules) {
		const decls = parseDeclarations(body).filter((d) => d.prop.startsWith('--'))
		if (decls.length === 0) continue

		const appliesLight = isRootSelector(selector)
		const appliesDark = isRootSelector(selector) || isDarkSelector(selector)

		for (const { prop, value } of decls) {
			if (appliesLight) light[prop] = value
			if (appliesDark) dark[prop] = value
		}
	}

	function resolve(value, map, seen = new Set()) {
		if (typeof value !== 'string' || !value.includes('var(')) return value
		// Substitutes every var() in the value, including inside a composite
		// like `0 2px 4px var(--np-shadow-tint)`. A var() with a fallback
		// (`var(--x, #fff)`) keeps the fallback if --x is unknown, which is
		// what the browser does.
		return value.replace(/var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (whole, ref, fallback) => {
			if (seen.has(ref)) return whole // cycle guard
			if (!(ref in map)) return fallback === undefined ? whole : fallback.trim()
			return resolve(map[ref], map, new Set([...seen, ref]))
		})
	}

	const resolvedLight = {}
	const resolvedDark = {}
	for (const name of new Set([...Object.keys(light), ...Object.keys(dark)])) {
		resolvedLight[name] = light[name] !== undefined ? resolve(light[name], light) : resolve(dark[name], dark)
		resolvedDark[name] = dark[name] !== undefined ? resolve(dark[name], dark) : resolve(light[name], light)
	}

	return { light: resolvedLight, dark: resolvedDark, rawLight: light, rawDark: dark }
}

function isHexColor(value) {
	return /^#([0-9a-f]{3,8})$/i.test(value.trim())
}

const canonical = extractCanonicalTokens()
const canonicalNames = Object.keys(canonical.light).sort()

// --- 2. Whole-app CSS analysis via Project Wallace's css-analyzer, for
// aggregate health metrics and raw-value token candidates.
// Scope: the stylesheets index.html actually links, in load order. Auditing
// the directory instead pulls in static/style.css -- 13k lines that #571
// stopped linking and nothing removed -- and every number comes out describing
// code the browser never sees. Before this scoping, 45 of the "conflicting
// multi-file definitions" were conflicts with that dead file alone.
const INDEX = join(ROOT, 'packages/noodle-web/src/noodle_web/templates/index.html')
const linkedRel = [...readFileSync(INDEX, 'utf8').matchAll(/href="\/static\/([^"?]+\.css)/g)].map((m) => m[1])
const cssFiles = linkedRel.map((rel) => join(STATIC_DIR, rel))
const unlinkedFiles = walkCssFiles(STATIC_DIR).filter((f) => !cssFiles.includes(f))
const combinedCss = cssFiles
	.map((f) => `/* == ${relative(ROOT, f)} == */\n${readFileSync(f, 'utf8')}`)
	.join('\n')

const analysis = analyze(combinedCss)
const rawTokens = analysis_to_tokens(analysis)

// css-analyzer's own properties.custom.used/unused under-counts var()
// references inside properties it doesn't model for var-detection (verified:
// font-family is one - var(--np-font-heading) is used four times in
// visual-system.css itself but analyze() still reports it "unused"). A plain
// text cross-reference is more reliable for this specific question, and
// lets us name every file that (re)defines a given token.
const definedIn = new Map() // propName -> Set(file)
const usedIn = new Map() // propName -> Set(file)
for (const file of cssFiles) {
	const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
	const rel = relative(ROOT, file)
	// The delimiter before the name matters: without it, the BEM modifier in
	// `.ben-view-btn--active:hover` reads as a declaration of `--active` and
	// the token shows up as a defined-but-unused custom property.
	for (const m of text.matchAll(/(?:^|[;{]|\s)(--[a-zA-Z][a-zA-Z0-9-]*)\s*:/gm)) {
		const set = definedIn.get(m[1]) ?? new Set()
		set.add(rel)
		definedIn.set(m[1], set)
	}
	for (const m of text.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
		const set = usedIn.get(m[1]) ?? new Set()
		set.add(rel)
		usedIn.set(m[1], set)
	}
}
// Names defined outside the app's own stylesheets. Bootstrap's CSS is loaded
// from a CDN and declares --bs-* on :root at runtime; the JS-animated ones are
// set as inline styles on the element. Neither is a dangling reference, and
// leaving them in the "unknown" list makes it look like there is always
// something to fix.
const EXTERNALLY_DEFINED = new Set([
	'--bs-primary',                                     // Bootstrap 5.3, via CDN
	'--circumference', '--percent', '--tx', '--ty',     // set inline by JS
	'--pf-restless-amplitude', '--wb-outline-depth',    // set inline by JS
])

// CSS is not the only consumer. mindmap.js and script.js read tokens off the
// root element with getComputedStyle().getPropertyValue(), so a name used only
// that way looks unused to a CSS-only scan -- and 18 of them did, including
// every --evm-line-* chart series colour and the whole --mm-* mind-map set.
// Deleting those on the strength of a CSS-only "unused" list would have
// blanked the EVM chart lines.
const scriptFiles = walkFiles(STATIC_DIR, '.js').filter((f) => !f.includes('/vendor/'))
for (const file of scriptFiles) {
	const text = readFileSync(file, 'utf8')
	const rel = relative(ROOT, file)
	// Only a quoted token name or a var() reference counts, and only for a
	// name some stylesheet already declares. A bare --foo match would drag in
	// every markdown rule and BEM-ish string in the codebase (`---raid`,
	// `--overdue`, a row of dashes in a template literal) and report them as
	// dangling references.
	for (const m of text.matchAll(/(?:['"`]|var\(\s*)(--[a-zA-Z][a-zA-Z0-9-]*)/g)) {
		if (!definedIn.has(m[1])) continue
		const set = usedIn.get(m[1]) ?? new Set()
		set.add(rel)
		usedIn.set(m[1], set)
	}
}

const allPropNames = new Set([...definedIn.keys(), ...usedIn.keys()])
const trulyUnused = [...allPropNames].filter((n) => definedIn.has(n) && !usedIn.has(n)).sort()
const trulyUnknown = [...allPropNames].filter((n) => usedIn.has(n) && !definedIn.has(n) && !EXTERNALLY_DEFINED.has(n)).sort()
function valuesByFile(name) {
	const out = {}
	for (const file of cssFiles) {
		const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
		const re = new RegExp(`${name.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+);`, 'g')
		const values = new Set([...text.matchAll(re)].map((m) => m[1].trim()))
		if (values.size > 0) out[relative(ROOT, file)] = [...values]
	}
	return out
}

// A name declared in two files is only a *token layering* problem when both
// declarations sit in the global token scope (:root / [data-theme="dark"]).
// A component that sets --mm-btn-bg on its own selector for light and again
// for dark is normal scoped theming, and counting it here buried the real
// conflicts under a pile of false ones.
function declaredAtGlobalScope(file, name) {
	const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
	for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const sel = m[1].trim()
		const global = /(^|,)\s*:root\s*(,|$)/.test(sel) || /\[data-theme=["']?dark["']?\]\s*(,|$)/.test(sel)
		if (!global) continue
		if (new RegExp(`${name.replace(/-/g, '\\-')}\\s*:`).test(m[2])) return true
	}
	return false
}

const multiFileDefinitions = [...definedIn.entries()]
	.filter(([, files]) => files.size > 1)
	.map(([name, files]) => ({
		name,
		valuesByFile: valuesByFile(name),
		globalScopeFiles: [...files].filter((rel) => declaredAtGlobalScope(join(ROOT, rel), name)),
	}))
	.filter(({ valuesByFile: vbf }) => new Set(Object.values(vbf).flat()).size > 1)
	.filter(({ globalScopeFiles }) => globalScopeFiles.length > 1)
	.sort((a, b) => a.name.localeCompare(b.name))

// Map canonical hex values -> token name, to spot raw duplicates.
const hexToToken = new Map()
for (const name of canonicalNames) {
	const v = canonical.light[name]
	if (isHexColor(v)) hexToToken.set(v.toLowerCase(), name)
	const vd = canonical.dark[name]
	if (isHexColor(vd)) hexToToken.set(vd.toLowerCase(), name)
}

function hexFromDtcgColor(token) {
	// css-design-tokens emits {colorSpace, components, alpha}; only handle srgb hex round-trip.
	const v = token.$value
	if (typeof v !== 'object' || v.colorSpace !== 'srgb') return null
	const [r, g, b] = v.components.map((c) => Math.round(c * 255))
	const toHex = (n) => n.toString(16).padStart(2, '0')
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase()
}

const colorFindings = []
for (const [id, token] of Object.entries(rawTokens.color ?? {})) {
	const hex = hexFromDtcgColor(token)
	const usage = token.$extensions?.['com.projectwallace.usage-count'] ?? 0
	const authoredAs = token.$extensions?.['com.projectwallace.css-authored-as']
	const props = token.$extensions?.['com.projectwallace.css-properties'] ?? []
	const matchedToken = hex ? hexToToken.get(hex.toLowerCase()) : null
	colorFindings.push({ id, hex, authoredAs, usage, props, matchedToken })
}
colorFindings.sort((a, b) => b.usage - a.usage)

const duplicateOfToken = colorFindings.filter((f) => f.matchedToken && f.usage > 1)
const unmatchedColors = colorFindings.filter((f) => !f.matchedToken)

function summarizeRawGroup(group) {
	return Object.entries(group ?? {})
		.map(([id, t]) => ({
			id,
			authoredAs: t.$extensions?.['com.projectwallace.css-authored-as'],
			usage: t.$extensions?.['com.projectwallace.usage-count'] ?? 0,
		}))
		.sort((a, b) => b.usage - a.usage)
}

// --- 4. Spacing audit. css-design-tokens has no spacing group, so collect
// the individual length values out of the box-model properties ourselves.
// The design-system question is "how many distinct spacing steps exist, and
// how many sit off the 4px grid" - both are counts of *authored lengths*, so
// a shorthand like `padding: 4px 8px` contributes two values, not one.
const SPACING_PROPS = new Set([
	'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
	'margin-block', 'margin-inline', 'margin-block-start', 'margin-block-end',
	'margin-inline-start', 'margin-inline-end',
	'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
	'padding-block', 'padding-inline', 'padding-block-start', 'padding-block-end',
	'padding-inline-start', 'padding-inline-end',
	'gap', 'row-gap', 'column-gap', 'grid-gap', 'grid-row-gap', 'grid-column-gap',
])

// A length token: number + optional unit. Deliberately excludes values inside
// var()/calc()/clamp() - those are already indirected and are not the drift
// this audit is looking for.
const LENGTH_RE = /(-?\d*\.?\d+)(px|rem|em|%|vh|vw|ch|ex)?\b/g

function collectSpacing(files) {
	const counts = new Map() // "8px" -> {value, unit, uses, props:Set, files:Set}
	let declarations = 0
	let indirected = 0 // declarations already using var()/calc()
	for (const file of files) {
		const rel = relative(ROOT, file)
		const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
		for (const m of text.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)[;}]/g)) {
			const prop = m[1].trim()
			if (!SPACING_PROPS.has(prop)) continue
			declarations++
			const value = m[2].trim()
			if (/var\(|calc\(|clamp\(|min\(|max\(/.test(value)) {
				indirected++
				continue
			}
			for (const lm of value.matchAll(LENGTH_RE)) {
				const num = parseFloat(lm[1])
				const unit = lm[2] ?? (num === 0 ? '' : 'px')
				if (unit === '%' || unit === 'vh' || unit === 'vw') continue // not a spacing step
				const key = num === 0 ? '0' : `${num}${unit}`
				const entry = counts.get(key) ?? { value: key, num, unit, uses: 0, props: new Set(), files: new Set() }
				entry.uses++
				entry.props.add(prop)
				entry.files.add(rel)
				counts.set(key, entry)
			}
		}
	}
	// Off-grid = a px value that is not a multiple of 4. em/rem are judged
	// against a 0.25 step, the em equivalent of a 4px grid at a 16px root.
	const onGrid = (e) => {
		if (e.num === 0) return true
		if (e.unit === 'px') return e.num % 4 === 0
		if (e.unit === 'rem' || e.unit === 'em') return Math.abs((e.num * 100) % 25) < 1e-6
		return true
	}
	const all = [...counts.values()].sort((a, b) => b.uses - a.uses)
	return {
		declarations,
		indirectedDeclarations: indirected,
		totalUniqueValues: all.length,
		offGridUniqueValues: all.filter((e) => !onGrid(e)).length,
		offGridUses: all.filter((e) => !onGrid(e)).reduce((n, e) => n + e.uses, 0),
		top: all.slice(0, 30).map((e) => ({
			value: e.value, uses: e.uses, onGrid: onGrid(e),
			props: [...e.props].sort(), fileCount: e.files.size,
		})),
		offGridTop: all.filter((e) => !onGrid(e)).slice(0, 25)
			.map((e) => ({ value: e.value, uses: e.uses, fileCount: e.files.size })),
	}
}

// --- 5. Component inventory. Groups selectors by the component family their
// class names imply, so "how many competing button implementations exist"
// has a number behind it. Families are matched on the *class* portion of a
// selector only, so `.card-body td` counts once, under card.
// Matched against the hyphen/underscore-separated segments of a class name,
// not a substring: `.kanban-btn` and `.btn-primary` are both buttons, while
// `.subtotal` is not a total and `.grid` in `.gridline` is not a table.
const COMPONENT_FAMILIES = [
	['button', ['btn', 'btns', 'button', 'buttons']],
	['badge', ['badge', 'badges', 'chip', 'chips', 'pill', 'pills', 'tag', 'tags', 'label']],
	['input', ['input', 'inputs', 'field', 'fields', 'select', 'textarea', 'checkbox', 'radio', 'form', 'control']],
	['card', ['card', 'cards', 'tile', 'tiles', 'panel', 'panels']],
	['modal', ['modal', 'modals', 'dialog', 'popover', 'dropdown', 'tooltip', 'menu', 'overlay', 'drawer']],
	['table', ['table', 'tables', 'grid', 'row', 'rows', 'cell', 'cells', 'col', 'cols', 'column', 'columns', 'th', 'td']],
	['nav', ['nav', 'navbar', 'tab', 'tabs', 'ribbon', 'toolbar', 'sidebar', 'breadcrumb', 'crumb']],
].map(([name, words]) => [name, new Set(words)])

// The interactive states a component is expected to define. Missing states are
// the accessibility half of the component story (#1193).
const STATE_RE = {
	hover: /:hover\b/,
	focus: /:focus(-visible)?\b/,
	active: /:active\b/,
	disabled: /(:disabled\b|\[disabled\]|\.disabled\b)/,
}

function collectComponents(files) {
	const fams = new Map(COMPONENT_FAMILIES.map(([name]) => [name, {
		name, selectors: new Set(), files: new Set(), rules: 0,
		classNames: new Map(), // distinct class names -> rule count
		states: { hover: 0, focus: 0, active: 0, disabled: 0 },
	}]))
	for (const file of files) {
		const rel = relative(ROOT, file)
		const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
		// Selector preludes: text before a `{` that isn't an at-rule or a declaration.
		for (const m of text.matchAll(/(^|[};])\s*([^{};@]+?)\s*\{/g)) {
			const prelude = m[2].trim()
			if (!prelude || prelude.startsWith('@')) continue
			for (const sel of prelude.split(',').map((s) => s.trim()).filter(Boolean)) {
				const classes = [...sel.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((c) => c[1])
				if (classes.length === 0) continue
				const segments = new Set(classes.flatMap((c) => c.split(/[-_]/).filter(Boolean)))
				for (const [name, words] of COMPONENT_FAMILIES) {
					if (![...segments].some((seg) => words.has(seg))) continue
					const f = fams.get(name)
					f.selectors.add(sel)
					f.files.add(rel)
					f.rules++
					for (const c of classes) {
						if (!c.split(/[-_]/).some((seg) => words.has(seg))) continue
						f.classNames.set(c, (f.classNames.get(c) ?? 0) + 1)
					}
					for (const [state, sre] of Object.entries(STATE_RE)) {
						if (sre.test(sel)) f.states[state]++
					}
				}
			}
		}
	}
	return [...fams.values()]
		.map((f) => ({
			family: f.name,
			rules: f.rules,
			uniqueSelectors: f.selectors.size,
			spreadAcrossFiles: f.files.size,
			files: [...f.files].sort(),
			stateRules: f.states,
			distinctClassNames: f.classNames.size,
			topClassNames: [...f.classNames.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 15)
				.map(([name, rules]) => ({ name, rules })),
		}))
		.sort((a, b) => b.rules - a.rules)
}

// --- 6. Styles authored outside CSS. The CSS files are only part of the
// surface: templates carry inline style="" attributes and the JS builds
// markup with style strings. Both are invisible to a CSS-only audit and
// both are places a hardcoded colour can hide.
const COLOR_LITERAL_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/

function collectOutOfBandStyles() {
	const templates = walkFiles(join(ROOT, 'packages/noodle-web/src/noodle_web/templates'), '.html')
	const scripts = walkFiles(STATIC_DIR, '.js').filter((f) => !f.includes('/vendor/'))

	const inlineAttr = []
	for (const file of templates) {
		const rel = relative(ROOT, file)
		const text = readFileSync(file, 'utf8')
		let total = 0
		let withColor = 0
		for (const m of text.matchAll(/\bstyle\s*=\s*"([^"]*)"/g)) {
			total++
			if (COLOR_LITERAL_RE.test(m[1])) withColor++
		}
		if (total > 0) inlineAttr.push({ file: rel, inlineStyleAttributes: total, containingColourLiteral: withColor })
	}

	// In JS, count colour literals that land in something style-shaped:
	// a style property assignment, a setProperty call, or a style="" string
	// inside generated markup.
	const jsColour = []
	for (const file of scripts) {
		const rel = relative(ROOT, file)
		const text = readFileSync(file, 'utf8')
		let hits = 0
		for (const line of text.split('\n')) {
			if (!COLOR_LITERAL_RE.test(line)) continue
			if (/\.style\b|setProperty\s*\(|style\s*=\s*["'`]|background|colour|color|border|shadow|fill|stroke/i.test(line)) hits++
		}
		if (hits > 0) jsColour.push({ file: rel, lines: hits })
	}
	jsColour.sort((a, b) => b.lines - a.lines)

	return {
		templates: inlineAttr,
		templateInlineStyleTotal: inlineAttr.reduce((n, t) => n + t.inlineStyleAttributes, 0),
		templateInlineStyleWithColour: inlineAttr.reduce((n, t) => n + t.containingColourLiteral, 0),
		scriptFilesWithColourLiterals: jsColour.length,
		scriptColourLineTotal: jsColour.reduce((n, f) => n + f.lines, 0),
		topScripts: jsColour.slice(0, 20),
	}
}

const spacing = collectSpacing(cssFiles)
const components = collectComponents(cssFiles)
const outOfBandStyles = collectOutOfBandStyles()

const summary = {
	filesScanned: cssFiles.map((f) => relative(ROOT, f)),
	// Present in the static directory but linked by no template, so nothing
	// here reaches a browser. Reported rather than scanned.
	filesNotLoaded: unlinkedFiles.map((f) => ({
		file: relative(ROOT, f),
		lines: readFileSync(f, 'utf8').split('\n').length,
	})),
	stylesheet: {
		sourceLinesOfCode: analysis.stylesheet.sourceLinesOfCode,
		complexity: analysis.stylesheet.complexity,
	},
	rules: { total: analysis.rules.total },
	selectors: {
		totalUnique: analysis.selectors.totalUnique,
		maxSpecificity: analysis.selectors.specificity.max,
	},
	customProperties: {
		totalDeclarations: analysis.properties.custom.total,
		totalUniqueNames: definedIn.size,
		unused: trulyUnused,
		unknown: trulyUnknown,
		conflictingMultiFileDefinitions: multiFileDefinitions,
	},
	canonicalTokenCount: canonicalNames.length,
	colors: {
		totalUnique: analysis.values.colors.totalUnique,
		duplicateOfTokenCount: duplicateOfToken.length,
		duplicateOfToken: duplicateOfToken.slice(0, 40),
		topUnmatched: unmatchedColors.slice(0, 25),
	},
	fontSizes: summarizeRawGroup(rawTokens.font_size),
	fontFamilies: summarizeRawGroup(rawTokens.font_family),
	lineHeights: summarizeRawGroup(rawTokens.line_height).slice(0, 20),
	radii: summarizeRawGroup(rawTokens.radius),
	boxShadows: summarizeRawGroup(rawTokens.box_shadow),
	spacing,
	components,
	outOfBandStyles,
}

writeFileSync(join(OUT_DIR, 'token-audit-data.json'), JSON.stringify(summary, null, 2) + '\n')

console.log(JSON.stringify(summary, null, 2))
