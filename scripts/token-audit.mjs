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

function walkCssFiles(dir) {
	const out = []
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry)
		const stats = statSync(full)
		if (stats.isDirectory()) {
			out.push(...walkCssFiles(full))
		} else if (entry.endsWith('.css')) {
			out.push(full)
		}
	}
	return out
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
