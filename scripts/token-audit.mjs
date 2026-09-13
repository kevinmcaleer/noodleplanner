#!/usr/bin/env node
// Token audit for the NoodlePlanner web app, built on Project Wallace's
// CSS tooling (@projectwallace/css-analyzer + @projectwallace/css-design-tokens).
//
// Scans packages/noodle-web/src/noodle_web/static for:
//   - the canonical --np-* design tokens declared in visual-system.css
//     (light + dark values), exported as DTCG-style token files for
//     Penpot's Tokens plugin and for Style Dictionary (Storybook)
//   - raw/one-off values elsewhere in the CSS that duplicate or compete
//     with those tokens, plus general CSS-health metrics
//
// Usage: node scripts/token-audit.mjs
// Writes docs/design/tokens/*.json and prints a JSON summary used to
// regenerate docs/design/token-audit.md's data tables by hand.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { analyze } from '@projectwallace/css-analyzer'
import { analysis_to_tokens } from '@projectwallace/css-design-tokens'

const ROOT = new URL('..', import.meta.url).pathname
const STATIC_DIR = join(ROOT, 'packages/noodle-web/src/noodle_web/static')
const VISUAL_SYSTEM = join(STATIC_DIR, 'visual-system.css')
const OUT_DIR = join(ROOT, 'docs/design/tokens')

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
		const m = value.match(/^var\((--[a-zA-Z0-9-]+)\)$/)
		if (!m) return value
		const ref = m[1]
		if (seen.has(ref)) return value // cycle guard
		if (!(ref in map)) return value
		seen.add(ref)
		return resolve(map[ref], map, seen)
	}

	const resolvedLight = {}
	const resolvedDark = {}
	for (const name of new Set([...Object.keys(light), ...Object.keys(dark)])) {
		resolvedLight[name] = light[name] !== undefined ? resolve(light[name], light) : resolve(dark[name], dark)
		resolvedDark[name] = dark[name] !== undefined ? resolve(dark[name], dark) : resolve(light[name], light)
	}

	return { light: resolvedLight, dark: resolvedDark, rawLight: light, rawDark: dark }
}

function categorize(name) {
	if (name.includes('font')) return 'typography'
	if (name.includes('radius')) return 'radius'
	if (name.includes('shadow')) return 'shadow'
	return 'color'
}

function isHexColor(value) {
	return /^#([0-9a-f]{3,8})$/i.test(value.trim())
}

const canonical = extractCanonicalTokens()
const canonicalNames = Object.keys(canonical.light).sort()

// --- 2. Whole-app CSS analysis via Project Wallace's css-analyzer, for
// aggregate health metrics and raw-value token candidates.
const cssFiles = walkCssFiles(STATIC_DIR)
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
	for (const m of text.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) {
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
const allPropNames = new Set([...definedIn.keys(), ...usedIn.keys()])
const trulyUnused = [...allPropNames].filter((n) => definedIn.has(n) && !usedIn.has(n)).sort()
const trulyUnknown = [...allPropNames].filter((n) => usedIn.has(n) && !definedIn.has(n)).sort()
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

const multiFileDefinitions = [...definedIn.entries()]
	.filter(([, files]) => files.size > 1)
	.map(([name]) => ({ name, valuesByFile: valuesByFile(name) }))
	.filter(({ valuesByFile: vbf }) => new Set(Object.values(vbf).flat()).size > 1)
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

mkdirSync(OUT_DIR, { recursive: true })

// --- 3. Emit DTCG-style token files (Tokens Studio multi-set convention,
// which both Penpot's Tokens plugin and Style Dictionary understand).
const core = {}
const colorLight = {}
const colorDark = {}

const DTCG_TYPE = { typography: 'fontFamily', radius: 'dimension', shadow: 'shadow' }

for (const name of canonicalNames) {
	const shortName = name.replace(/^--np-/, '').replace(/^--/, '')
	const category = categorize(name)
	const lightValue = canonical.light[name]
	const darkValue = canonical.dark[name]

	if (category === 'color') {
		colorLight[shortName] = { $type: 'color', $value: lightValue, $description: name }
		colorDark[shortName] = { $type: 'color', $value: darkValue, $description: name }
	} else {
		core[shortName] = { $type: DTCG_TYPE[category], $value: lightValue, $description: name }
	}
}

writeFileSync(join(OUT_DIR, 'core.json'), JSON.stringify(core, null, 2) + '\n')
writeFileSync(join(OUT_DIR, 'color-light.json'), JSON.stringify(colorLight, null, 2) + '\n')
writeFileSync(join(OUT_DIR, 'color-dark.json'), JSON.stringify(colorDark, null, 2) + '\n')
writeFileSync(
	join(OUT_DIR, '$themes.json'),
	JSON.stringify(
		[
			{ id: 'light', name: 'Light', selectedTokenSets: { core: 'enabled', 'color-light': 'enabled', 'color-dark': 'disabled' } },
			{ id: 'dark', name: 'Dark', selectedTokenSets: { core: 'enabled', 'color-light': 'disabled', 'color-dark': 'enabled' } },
		],
		null,
		2,
	) + '\n',
)

// Set order is the other half of the multi-file convention: a set later in the
// list overrides an earlier one, so without this the importer is free to resolve
// a name defined in both `core` and a `color-*` set either way round.
writeFileSync(
	join(OUT_DIR, '$metadata.json'),
	JSON.stringify({ tokenSetOrder: ['core', 'color-light', 'color-dark'] }, null, 2) + '\n',
)

writeFileSync(join(OUT_DIR, '..', 'token-audit-data.json'), JSON.stringify(summary, null, 2) + '\n')

console.log(JSON.stringify(summary, null, 2))
