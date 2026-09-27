#!/usr/bin/env node
/**
 * Move the shared layer's colour literals onto tokens, with no visible change
 * in either theme (#1323).
 *
 * components.css and dark-mode.css held ~400 of the raw-colour findings, and a
 * lot of dark-mode.css exists only because a light rule in components.css
 * hard-codes a colour that dark mode then has to override. Once the light rule
 * names a token that swaps between themes by itself, the override has nothing
 * left to do and is deleted.
 *
 * ## What "no visible change" allows
 *
 * The palette for the Bootstrap-era cool greys (#e0e0e0, #333, #f8f9fa ...) is
 * #1322's decision, not this script's. So this only makes substitutions that
 * are exact in both themes -- no nearest match, no perceptual threshold.
 * adopt-neutral-colours.mjs accepts 1.1:1 and adopt-shadow-tokens.mjs changes
 * dark mode on purpose; this does neither. There are four moves:
 *
 * 1. **A light literal becomes a token** when the token's light value is the
 *    literal, exactly, after normalising hex case, shorthand and rgb(). The
 *    light theme is then the identity. Dark mode is unchanged in one of two
 *    ways, and nothing else counts:
 *      - the token has the same value in dark (the identity hues, the note
 *        colours, --np-on-accent ...), or
 *      - a `[data-theme="dark"]` rule with *the same selector* already sets
 *        that property. It is strictly more specific and matches exactly the
 *        same elements, so in dark the light declaration never paints at all.
 *    Where there is such an override, the token whose dark value is what the
 *    override paints is preferred -- that is what lets move 3 delete it.
 *
 * 2. **A literal inside a dark rule becomes a token** when the token's dark
 *    value is the literal, exactly. Dark rules do not apply in light, so this
 *    is the identity in both themes.
 *
 * 3. **A dark declaration is deleted** when the plain rule with the same
 *    selector already renders the same value in dark -- compared by resolving
 *    both through the dark token values, so `var(--np-text)` equals
 *    `var(--np-ink)` equals `#FAF8F4`. This is drop-redundant-dark-overrides.mjs
 *    widened from "byte-identical" to "resolves identically", plus a hazard
 *    that script did not check:
 *
 *    **Deleting an override can promote a third rule.** An override beats the
 *    plain rule by one attribute's worth of specificity; anything that sat in
 *    that gap -- `.panel .x`, a later `.x` inside an @media, a
 *    `[data-theme="dark"] button` -- was losing to the override and would win
 *    once it is gone. So a deletion is refused if any other rule setting the
 *    same property family, with specificity in that gap, could match the same
 *    element: its subject compound shares a class or id with ours, or has no
 *    class or id at all (so could be anything). That is conservative -- it
 *    refuses some deletions that are in fact safe -- and on purpose.
 *
 * 4. **A colour literal that never paints is deleted.** visual-system.css's
 *    `:root body .x` layer restyled the ribbon, the calendar, the table heads
 *    and more on top of the old rules, and left those rules in place, still
 *    carrying colours no one can see. A declaration is dead when, for each
 *    selector of its rule and each longhand it sets, some other declaration
 *    always beats it:
 *      - it wins the cascade outright: !important against a normal one, or
 *        higher specificity, or equal specificity and later -- where "later"
 *        must hold on every page that loads the file (collab_join.html loads a
 *        shorter list, in a different order), so the winner's file has to be
 *        on all of them in the same relative order;
 *      - it is unconditional, or under the same @media as the loser;
 *      - its selector matches every element the loser's matches, in every
 *        state: its subject compound is a subset of the loser's (so `.x`
 *        covers `.x:hover`, `:is(thead, th)` covers `th`), and each of its
 *        ancestor compounds is implied, in order, by one of the loser's. The
 *        `:root body` prefix counts as always true for anything named by a
 *        class or id the app never puts on <html> or <body> (ROOT_CLASSES).
 *    Deleting what never wins changes nothing, in any state, on any page.
 *    "Matches nothing on any screen we captured" is not evidence and is not
 *    used: a view nobody opened is still a view.
 *
 *    A border or outline *shorthand* is a special case: often only its colour
 *    loses (visual-system.css sets `border-color`), while its width and style
 *    still paint. Then just the literal is dropped -- `1px solid #d8e1e5`
 *    becomes `1px solid` -- and the colour longhand, now currentColor, still
 *    loses to the same winner.
 *
 * ## Which token, when several share a value
 *
 * Only a token whose role fits the property is a candidate: `color` never
 * becomes a surface token, `background` never a text token. That table is
 * ROLES below, and it is hand-written for the same reason adopt-status-ramp's
 * is -- every line is reviewable, and a token nobody has placed in a role is
 * simply never chosen. The compatibility aliases (--np-text, --np-bg ...) are
 * never chosen either; they are resolved when reading existing values.
 *
 * Three families are left out of the table on purpose, although their values
 * do match literals in these files:
 *   - --np-on-success / --np-on-info / --np-on-accent. `#fff` on a coloured
 *     badge is not "the ink for the success colour" just because the two are
 *     both white in light; on-success is #161616 in dark.
 *   - --np-qr-ink / --np-qr-paper. A QR code's modules, not "white".
 *   - --np-editor-*. The editor's own dark surface; a textarea elsewhere that
 *     happens to use #d4d4d4 is not the editor.
 *
 * ## What it does not touch
 *
 * - Literals inside var() fallbacks, and custom-property declarations.
 * - Tokens that are redefined below :root anywhere (the avatar ring and size,
 *   the front-matter panel's pinned np-button colours): their value at an
 *   element is not the value this script reads.
 * - Anything with no exact token. That is the palette decision, and the
 *   --report listing is its input.
 *
 * Proof, as for its siblings, is capture before and after:
 * scripts/capture_screen_audit.py + scripts/compare_screens.py in both themes.
 *
 * Usage:
 *   node scripts/adopt-exact-colour-tokens.mjs --dry-run            what would change
 *   node scripts/adopt-exact-colour-tokens.mjs                      apply
 *   node scripts/adopt-exact-colour-tokens.mjs --report             every literal left, and why
 *   node scripts/adopt-exact-colour-tokens.mjs --changed            the selectors a run would touch, to
 *                                                                   point a before/after capture at
 *   node scripts/adopt-exact-colour-tokens.mjs --only <regex>       limit to selectors matching
 *   node scripts/adopt-exact-colour-tokens.mjs --moves 1,2,3,4      limit to some moves
 *   node scripts/adopt-exact-colour-tokens.mjs --dry-run --verbose  also the winner behind each move 4
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const STATIC_DIR = join(ROOT, 'packages/noodle-web/src/noodle_web/static')
const INDEX = join(ROOT, 'packages/noodle-web/src/noodle_web/templates/index.html')
const CANONICAL = join(STATIC_DIR, 'visual-system.css')
// The only files this edits. Every linked file is *read*, because any of them
// can hold the rule that makes a deletion unsafe.
const TARGETS = new Set(['components.css', 'dark-mode.css'])

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const report = args.includes('--report')
const listChanged = args.includes('--changed')
const verbose = args.includes('--verbose')
const only = args.includes('--only') ? new RegExp(args[args.indexOf('--only') + 1]) : null
const moves = new Set((args.includes('--moves') ? args[args.indexOf('--moves') + 1] : '1,2,3,4').split(',').map(Number))
const linked = [...readFileSync(INDEX, 'utf8').matchAll(/href="\/static\/([^"?]+\.css)/g)].map((m) => m[1])

// --- Colours ---------------------------------------------------------------

const LITERAL_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^()]*\)/g

/** A colour literal as canonical `r,g,b,a`, or null if it is not one. */
function norm(lit) {
	const s = lit.trim().toLowerCase()
	let m = /^#([0-9a-f]{3,8})$/.exec(s)
	if (m) {
		let h = m[1]
		if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
		if (h.length !== 6 && h.length !== 8) return null
		const n = (i) => parseInt(h.slice(i, i + 2), 16)
		const a = h.length === 8 ? n(6) / 255 : 1
		return `${n(0)},${n(2)},${n(4)},${+a.toFixed(3)}`
	}
	m = /^rgba?\(([^()]*)\)$/.exec(s)
	if (m) {
		const parts = m[1].split(/[\s,/]+/).filter(Boolean)
		if (parts.length < 3 || parts.length > 4) return null
		if (parts.slice(0, 3).some((p) => !/^\d+(\.\d+)?$/.test(p))) return null
		let a = 1
		if (parts[3] !== undefined) {
			a = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
			if (Number.isNaN(a)) return null
		}
		return `${+parts[0]},${+parts[1]},${+parts[2]},${+a.toFixed(3)}`
	}
	return null
}

// --- Tokens, read from the generated block ----------------------------------

const canonicalText = readFileSync(CANONICAL, 'utf8')
const block = canonicalText.slice(canonicalText.indexOf('BEGIN PENPOT TOKENS'), canonicalText.indexOf('END PENPOT TOKENS'))
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
const blockBare = stripComments(block)
const darkAt = blockBare.indexOf('[data-theme="dark"]')
const declsOf = (text) => new Map([...text.matchAll(/(--np-[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
const rawLight = declsOf(blockBare.slice(0, darkAt))
const rawDark = new Map([...rawLight, ...declsOf(blockBare.slice(darkAt))])

function resolveIn(raw, name, seen = new Set()) {
	if (seen.has(name)) return null
	seen.add(name)
	const v = raw.get(name)
	if (v === undefined) return null
	const m = /^var\((--np-[a-z0-9-]+)\)$/.exec(v)
	if (m) return resolveIn(raw, m[1], seen)
	return norm(v)
}

// Custom properties re-declared on some element below :root. Their value at an
// element is not what the block says, so they are neither chosen nor resolved.
const LOCALLY_REDEFINED = new Set()
for (const rel of linked) {
	if (rel === 'visual-system.css') continue
	const css = stripComments(readFileSync(join(STATIC_DIR, rel), 'utf8'))
	for (const m of css.matchAll(/(--np-[a-z0-9-]+)\s*:/g)) LOCALLY_REDEFINED.add(m[1])
}

const TOKENS = new Map() // name -> { light, dark }
for (const name of rawLight.keys()) {
	if (LOCALLY_REDEFINED.has(name)) continue
	const light = resolveIn(rawLight, name)
	const dark = resolveIn(rawDark, name)
	if (light && dark) TOKENS.set(name, { light, dark })
}

// --- Roles: which tokens may stand for a colour in which property family ----
//
// Order within a role is the preference when two tokens tie on value.

const HUES = ['--np-red', '--np-orange', '--np-yellow', '--np-green', '--np-blue', '--np-purple', '--np-dark-blue', '--np-light-grey']
const SUBTLES = HUES.map((h) => `${h}-subtle`)
const STATUS = ['--np-danger', '--np-success', '--np-warning', '--np-info', '--np-accent', '--np-sage']
const STATUS_HOVER = ['--np-danger-hover', '--np-success-hover', '--np-warning-hover', '--np-info-hover', '--np-accent-hover']
const STATUS_TINT = ['--np-danger-tint', '--np-success-tint', '--np-warning-tint', '--np-info-tint', '--np-accent-tint', '--np-sage-tint', '--np-accent-soft']
const STATUS_INK = ['--np-danger-ink', '--np-success-ink', '--np-warning-ink', '--np-info-ink', '--np-accent-ink', '--np-sage-ink']
const NOTES = ['yellow', 'pink', 'green', 'blue', 'red'].flatMap((c) => [`--np-note-${c}-1`, `--np-note-${c}-2`])

const ROLES = {
	text: ['--np-ink', '--np-body', '--np-muted', '--np-faint', '--np-ink-hover', ...STATUS_INK,
		'--np-link', '--np-link-hover',
		...STATUS, ...HUES, '--np-link-highlight-ink',
		'--np-note-ink', '--np-note-ink-muted', '--np-note-ink-faint'],
	background: ['--np-paper', '--np-surface', '--np-surface-alt', '--np-sunken', '--np-selected',
		...STATUS, ...STATUS_HOVER, ...STATUS_TINT, ...HUES, ...SUBTLES, '--np-link-highlight',
		...NOTES, '--np-overlay'],
	border: ['--np-border', '--np-border-strong', '--np-hairline', '--np-hairline-warm', '--np-border-control',
		...STATUS, ...STATUS_HOVER, ...HUES, '--np-focus-ring-color'],
	shadow: ['--np-shadow', '--np-shadow-strong', '--np-shadow-tint', '--np-shadow-tint-strong'],
}

function familyOf(prop) {
	if (/^(color|caret-color|text-decoration-color|fill|stroke)$/.test(prop)) return 'text'
	if (/^background(-color|-image)?$/.test(prop)) return 'background'
	if (/^(border|outline|column-rule)/.test(prop)) return 'border'
	if (/^(box-shadow|text-shadow)$/.test(prop)) return 'shadow'
	return null
}

/** For deletion safety: properties that can set the same computed longhand. */
function cascadeGroup(prop) {
	if (/^background/.test(prop)) return 'background'
	if (/^border(?!-radius|-collapse|-spacing|-image)/.test(prop)) return 'border'
	if (/^outline/.test(prop)) return 'outline'
	return prop
}

/** Does a dark declaration of `darkProp` override the colour a light `prop` paints? */
function covers(darkProp, prop, literalInGradient) {
	if (darkProp === prop) return true
	if (prop === 'background') return literalInGradient ? darkProp === 'background-image' : darkProp === 'background-color'
	if (prop === 'background-color') return darkProp === 'background'
	const side = /^border-(top|right|bottom|left)/.exec(prop)?.[1]
	if (/^border(-(top|right|bottom|left))?(-color)?$/.test(prop)) {
		if (darkProp === 'border-color') return true
		if (darkProp === 'border') return true
		if (side && (darkProp === `border-${side}` || darkProp === `border-${side}-color`)) return true
		return false
	}
	if (prop === 'outline') return darkProp === 'outline-color'
	return false
}

// --- Parsing: rules with offsets, at-rule context and declarations ----------

function parse(text) {
	const bare = stripComments(text)
	const out = []
	const stack = []
	let preludeStart = 0
	let quote = null
	for (let i = 0; i < bare.length; i++) {
		const c = bare[i]
		if (quote) { if (c === quote && bare[i - 1] !== '\\') quote = null; continue }
		if (c === '"' || c === "'") { quote = c; continue }
		if (c === '{') {
			const prelude = bare.slice(preludeStart, i).trim()
			stack.push({ prelude, open: i, preludeStart: preludeStart + (bare.slice(preludeStart, i).length - bare.slice(preludeStart, i).trimStart().length) })
			preludeStart = i + 1
		} else if (c === '}') {
			const frame = stack.pop()
			if (frame && !frame.prelude.startsWith('@')) {
				const at = stack.filter((f) => f.prelude.startsWith('@')).map((f) => f.prelude.replace(/\s+/g, ' ')).join(' / ')
				if (!/^@keyframes/.test(stack.at(-1)?.prelude ?? '')) {
					out.push({ prelude: frame.prelude, preludeStart: frame.preludeStart, at, bodyStart: frame.open + 1, bodyEnd: i, decls: declarations(bare, frame.open + 1, i) })
				}
			}
			preludeStart = i + 1
		} else if (c === ';' && stack.length === 0) {
			preludeStart = i + 1 // @import / @charset
		}
	}
	return out
}

function declarations(bare, start, end) {
	const out = []
	let s = start
	let depth = 0
	let quote = null
	const flush = (e) => {
		const raw = bare.slice(s, e)
		const i = raw.indexOf(':')
		if (i !== -1) {
			const prop = raw.slice(0, i).trim().toLowerCase()
			if (prop && /^-?[a-z-]+$/.test(prop)) {
				const vStart = s + i + 1
				const lead = bare.slice(vStart, e).match(/^\s*/)[0].length
				const trail = bare.slice(vStart, e).match(/\s*$/)[0].length
				let valueStart = vStart + lead
				let valueEnd = e - trail
				let value = bare.slice(valueStart, valueEnd)
				const important = /!\s*important\s*$/i.test(value)
				out.push({ prop, value, valueStart, valueEnd, declStart: s, declEnd: e, important })
			}
		}
	}
	for (let i = start; i < end; i++) {
		const c = bare[i]
		if (quote) { if (c === quote) quote = null; continue }
		if (c === '"' || c === "'") quote = c
		else if (c === '(') depth++
		else if (c === ')') depth--
		else if (c === ';' && depth === 0) { flush(i); s = i + 1 }
	}
	if (bare.slice(s, end).trim()) flush(end)
	return out
}

const splitSelectors = (prelude) => {
	const out = []
	let depth = 0
	let cur = ''
	for (const c of prelude) {
		if (c === '(') depth++
		if (c === ')') depth--
		if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue }
		cur += c
	}
	if (cur.trim()) out.push(cur.trim())
	return out.map((s) => s.replace(/\s+/g, ' ').replace(/\s*([>+~])\s*/g, ' $1 '))
}

const DARK_PREFIX = /^\[data-theme=["']?dark["']?\] /

/** [a, b, c] specificity, :is/:not/:has taking their most specific argument, :where none. */
function specificity(sel) {
	let a = 0
	let b = 0
	let c = 0
	let s = sel
	// Functional pseudo-classes first, recursively.
	s = s.replace(/:(is|not|has|where|matches)\(((?:[^()]|\([^()]*\))*)\)/g, (_, fn, inner) => {
		if (fn !== 'where') {
			const best = splitSelectors(inner).map(specificity).sort(cmpSpec).at(-1) ?? [0, 0, 0]
			a += best[0]; b += best[1]; c += best[2]
		}
		return ' '
	})
	s = s.replace(/:(nth-[a-z-]+|lang|dir)\([^()]*\)/g, () => { b++; return ' ' })
	s = s.replace(/::[a-z-]+(\([^()]*\))?/g, () => { c++; return ' ' })
	s = s.replace(/:(before|after|first-line|first-letter)\b/g, () => { c++; return ' ' })
	s = s.replace(/#[\w-]+/g, () => { a++; return ' ' })
	s = s.replace(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g, () => { b++; return ' ' })
	s = s.replace(/(^|[\s>+~])([a-zA-Z][\w-]*)/g, (m, p) => { c++; return p })
	return [a, b, c]
}
const cmpSpec = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]

/** Classes and ids of the subject (rightmost) compound, and whether it has any. */
function subject(sel) {
	const parts = sel.replace(/\((?:[^()]|\([^()]*\))*\)/g, (m) => m.replace(/[\s>+~]/g, '_')).split(/\s+[>+~]?\s*/)
	const last = parts.at(-1)
	const names = new Set([...last.matchAll(/[.#][\w-]+/g)].map((m) => m[0]))
	// Classes named inside :is()/:not() etc. of the subject count too.
	for (const m of last.matchAll(/[.#][\w-]+/g)) names.add(m[0])
	return names
}


// --- Which element types a class is put on ------------------------------------
//
// A competitor whose subject is a bare element type -- `.milestones-table
// thead`, `.shortcut-row kbd` -- can only reach our element if our element is
// that type. The markup says which types a class goes on: an HTML string
// (`<div class="qa-check-card">`), or a `className`/`classList` write shortly
// after a `createElement('div')`. Any use this cannot pin to a type makes the
// answer "could be anything", which blocks the deletion.

const SOURCE_FILES = []
{
	const walk = (dir) => {
		for (const ent of readdirSync(dir, { withFileTypes: true })) {
			const p = join(dir, ent.name)
			if (ent.isDirectory()) { if (!/vendor|node_modules/.test(ent.name)) walk(p) }
			else if (/\.(js|mjs|html)$/.test(ent.name) && !/\.stories\.|\.min\./.test(ent.name)) SOURCE_FILES.push(readFileSync(p, 'utf8'))
		}
	}
	walk(STATIC_DIR)
	walk(join(ROOT, 'packages/noodle-web/src/noodle_web/templates'))
}
const tagCache = new Map()
/** Element types that carry class/id `name` ('.x' or '#x'), or null for "unknown". */
function tagsFor(name) {
	if (tagCache.has(name)) return tagCache.get(name)
	const bare = name.slice(1)
	const re = new RegExp(`(^|[^\\w-])${bare.replace(/[-]/g, '\\-')}(?![\\w-])`, 'g')
	let tags = new Set()
	let found = false
	for (const src of SOURCE_FILES) {
		for (const m of src.matchAll(re)) {
			const at = m.index + m[1].length
			const lineStart = src.lastIndexOf('\n', at) + 1
			const before = src.slice(Math.max(0, at - 400), at)
			const line = src.slice(lineStart, src.indexOf('\n', at) === -1 ? src.length : src.indexOf('\n', at))
			const attr = name[0] === '.' ? /class(Name)?\s*=\s*["'`{][^"'`]*$/ : /\bid\s*=\s*["'`][^"'`]*$/
			const open = /<([a-zA-Z][\w-]*)\b[^<>]*$/.exec(before)
			if (open && attr.test(before)) { tags.add(open[1].toLowerCase()); found = true; continue }
			const write = name[0] === '.'
				? /className\s*[+]?=|classList\.(add|toggle|replace)|setAttribute\(\s*['"]class|\bclass\s*:|\bclassName\s*:/
				: /\.id\s*=|setAttribute\(\s*['"]id|\bid\s*:/
			if (write.test(line)) {
				const ctx = src.slice(Math.max(0, lineStart - 600), at)
				const made = [...ctx.matchAll(/createElement\(\s*['"]([\w-]+)['"]/g)].at(-1)
				if (!made) { tagCache.set(name, null); return null }
				tags.add(made[1].toLowerCase()); found = true
			}
		}
	}
	const out = found ? tags : null
	tagCache.set(name, out)
	return out
}
/** The element type a selector's subject names, or '*' if none. */
function subjectTag(sel) {
	const last = sel.replace(/\((?:[^()]|\([^()]*\))*\)/g, '()').split(/\s+[>+~]?\s*/).at(-1)
	return /^([a-zA-Z][\w-]*)/.exec(last)?.[1].toLowerCase() ?? '*'
}
/** The pseudo-element a selector's subject is, or '' for the element itself. */
function pseudoElement(sel) {
	const m = /::?(before|after|placeholder|selection|marker|first-line|first-letter|backdrop|-webkit-[\w-]+|-moz-[\w-]+)\s*$/.exec(sel.replace(/\((?:[^()]|\([^()]*\))*\)/g, '()'))
	return m ? m[1] : ''
}
/** Could an element matched by `sel` be of type `tag`? */
function tagCouldBe(sel, tag) {
	if (tag === '*') return true
	const own = subjectTag(sel)
	if (own !== '*') return own === tag
	const names = [...subject(sel)]
	if (!names.length) return true
	// Every name in the subject must be on the element, so any one of them
	// that is never put on a `tag` is enough.
	return names.every((n) => { const t = tagsFor(n); return t === null || t.has(tag) })
}

// --- Load everything ----------------------------------------------------------

const files = linked.map((rel, order) => {
	const text = readFileSync(join(STATIC_DIR, rel), 'utf8')
	return { rel, order, text, bare: stripComments(text), rules: parse(text) }
})

// Every declaration in the cascade, flattened with its order.
const all = []
let seq = 0
for (const f of files) {
	for (const r of f.rules) {
		const sels = splitSelectors(r.prelude)
		for (const d of r.decls) {
			if (d.prop.startsWith('--')) continue
			for (const sel of sels) all.push({ file: f.rel, rule: r, sel, prop: d.prop, decl: d, spec: specificity(sel), seq: seq })
		}
		seq++
	}
}
const bySelProp = new Map()
for (const e of all) {
	const k = `${e.sel}|${e.prop}`
	if (!bySelProp.has(k)) bySelProp.set(k, [])
	bySelProp.get(k).push(e)
}

/** A value as it renders in `theme`: tokens resolved, literals canonical. */
function rendered(value, theme) {
	return value.replace(/!\s*important/i, '').trim()
		.replace(/var\((--np-[a-z0-9-]+)\)/g, (m, name) => {
			const t = TOKENS.get(name)
			return t ? `<${t[theme]}>` : m
		})
		.replace(LITERAL_RE, (m) => (norm(m) ? `<${norm(m)}>` : m))
		.replace(/\s+/g, ' ').toLowerCase()
}

/** The dark declarations that override `prop` for exactly this selector. */
function darkOverrides(sel, at, prop, important, literalInGradient) {
	const out = []
	for (const [k, list] of bySelProp) {
		if (!k.startsWith(`[data-theme="dark"] ${sel}|`)) continue
		for (const e of list) {
			if (e.sel !== `[data-theme="dark"] ${sel}`) continue
			if (!covers(e.prop, prop, literalInGradient)) continue
			if (e.rule.at && e.rule.at !== at) continue // conditional override: does not always apply
			if (important && !e.decl.important) continue
			out.push(e)
		}
	}
	return out
}

// --- Plan the edits -----------------------------------------------------------

const edits = new Map() // file -> [{start, end, text}]
const addEdit = (file, start, end, text) => {
	if (!edits.has(file)) edits.set(file, [])
	edits.get(file).push({ start, end, text })
}
const counts = { move1: 0, move2: 0, move3: 0, move4: 0, rulesEmptied: 0 }
const log = []
const leftovers = [] // { file, dark, prop, lit, sel, why }

// Declarations whose value this run rewrites, so move 3 compares against the
// value *after* moves 1 and 2.
const newValue = new Map() // decl -> value

const pickRole = (prop, literal, predicate) => {
	const fam = familyOf(prop)
	if (!fam) return []
	return ROLES[fam].filter((name) => TOKENS.has(name) && predicate(TOKENS.get(name)))
}

for (const f of files) {
	if (!TARGETS.has(f.rel)) continue
	for (const r of f.rules) {
		const sels = splitSelectors(r.prelude)
		const darkRule = sels.every((s) => DARK_PREFIX.test(s))
		const mixed = !darkRule && sels.some((s) => DARK_PREFIX.test(s))
		if (only && !only.test(r.prelude)) continue
		for (const d of r.decls) {
			if (d.prop.startsWith('--')) continue
			const fam = familyOf(d.prop)
			// Literals outside var() fallbacks.
			const masked = d.value.replace(/var\((?:[^()]|\([^()]*\))*\)/g, (m) => ' '.repeat(m.length))
			const lits = [...masked.matchAll(LITERAL_RE)].filter((m) => norm(m[0]))
			if (!lits.length) continue
			let value = d.value
			let changed = false
			// Right to left so offsets hold.
			for (const m of lits.reverse()) {
				const lit = m[0]
				const n = norm(lit)
				const inGradient = /gradient\(/.test(d.value)
				let token = null
				let why = null
				if (mixed) why = 'rule mixes themed and unthemed selectors'
				else if (!fam) why = `property ${d.prop} has no colour role`
				else if (darkRule) {
					const cands = pickRole(d.prop, n, (t) => t.dark === n)
					if (!moves.has(2)) why = 'move 2 disabled'
					else if (!cands.length) why = 'no token has this dark value'
					else {
						// Prefer what the plain rule for the same selector uses.
						const plainTokens = new Set()
						for (const s of sels) {
							for (const e of bySelProp.get(`${s.replace(DARK_PREFIX, '')}|${d.prop}`) ?? []) {
								for (const v of e.decl.value.matchAll(/var\((--np-[a-z0-9-]+)\)/g)) plainTokens.add(v[1])
								for (const v of e.decl.value.matchAll(LITERAL_RE)) {
									for (const c of cands) if (TOKENS.get(c).light === norm(v[0])) plainTokens.add(c)
								}
							}
						}
						token = cands.find((c) => plainTokens.has(c)) ?? cands[0]
					}
				} else {
					const cands = pickRole(d.prop, n, (t) => t.light === n)
					if (!moves.has(1)) why = 'move 1 disabled'
					else if (!cands.length) why = 'no token has this light value'
					else {
						const overrides = sels.map((s) => darkOverrides(s, r.at, d.prop, d.important, inGradient))
						const covered = overrides.every((o) => o.length)
						if (covered) {
							// What dark actually paints, per selector (last override wins on a tie).
							const painted = overrides.map((o) => o.map((e) => rendered(e.decl.value, 'dark')))
							token = cands.find((c) => painted.every((p) => p.some((v) => v.includes(`<${TOKENS.get(c).dark}>`)))) ??
								cands.find((c) => TOKENS.get(c).dark === n) ?? cands[0]
						} else {
							token = cands.find((c) => TOKENS.get(c).dark === n) ?? null
							if (!token) why = `light value matches ${cands.join(', ')} but dark would change (no same-selector dark override)`
						}
					}
				}
				if (!token) {
					leftovers.push({ decl: d, file: f.rel, dark: darkRule, prop: d.prop, lit, n, sel: r.prelude.replace(/\s+/g, ' '), at: r.at, why, value: d.value })
					continue
				}
				value = value.slice(0, m.index) + `var(${token})` + value.slice(m.index + lit.length)
				changed = true
				counts[darkRule ? 'move2' : 'move1']++
				log.push(`${darkRule ? '2' : '1'}  ${f.rel.padEnd(15)} ${d.prop}: ${lit} -> var(${token})   ${r.prelude.replace(/\s+/g, ' ').slice(0, 70)}`)
			}
			if (changed) newValue.set(d, value)
		}
	}
}

// Move 3: delete dark declarations that render the same as their plain rule.
const deletions = new Map() // rule -> Set(decl)
if (moves.has(3)) {
	for (const f of files) {
		if (!TARGETS.has(f.rel)) continue
		for (const r of f.rules) {
			if (only && !only.test(r.prelude)) continue
			const sels = splitSelectors(r.prelude)
			if (!sels.length || !sels.every((s) => DARK_PREFIX.test(s))) continue
			for (const d of r.decls) {
				if (d.prop.startsWith('--') || d.important) continue
				const ok = sels.every((dsel) => {
					const sel = dsel.replace(DARK_PREFIX, '')
					const darkSpec = specificity(dsel)
					const me = all.find((e) => e.decl === d && e.sel === dsel)
					// The plain declaration that would take over: the last one with
					// this exact selector and property that applies wherever this does.
					const plain = (bySelProp.get(`${sel}|${d.prop}`) ?? []).filter((e) => !e.rule.at || e.rule.at === r.at)
					const base = plain.at(-1)
					if (!base || base.decl.important) return false
					const baseVal = newValue.get(base.decl) ?? base.decl.value
					const darkVal = newValue.get(d) ?? d.value
					if (/var\(--(?!np-)|var\(--np-avatar/.test(baseVal + darkVal)) return false
					if (rendered(baseVal, 'dark') !== rendered(darkVal, 'dark')) return false
					// Anything between the plain rule and this one in the cascade.
					const group = cascadeGroup(d.prop)
					const mine = subject(sel)
					for (const e of all) {
						if (e === me || e === base || cascadeGroup(e.prop) !== group) continue
						if (e.decl.important) {
							continue // wins before and after alike
						}
						const lo = cmpSpec(e.spec, base.spec)
						const hi = cmpSpec(e.spec, darkSpec)
						const aboveBase = lo > 0 || (lo === 0 && e.seq > base.seq)
						const belowDark = hi < 0 || (hi === 0 && e.seq < me.seq)
						if (!aboveBase || !belowDark) continue
						// A pseudo-element is a different box: `.x::before` cannot
						// promote anything on `.x`, nor the reverse.
						if (pseudoElement(e.sel) !== pseudoElement(sel)) continue
						const theirs = subject(e.sel)
						const disjoint = theirs.size
							? ![...theirs].some((x) => mine.has(x))
							: !tagCouldBe(sel, subjectTag(e.sel))
						if (disjoint) continue
						// Same resolved value in dark does no harm.
						if (rendered(newValue.get(e.decl) ?? e.decl.value, 'dark') === rendered(baseVal, 'dark') && e.prop === d.prop) continue
						if (verbose) console.log(`  keep ${dsel} ${d.prop}: blocked by ${e.sel} {${e.prop}: ${e.decl.value}} (${e.file})`)
						return false
					}
					return true
				})
				if (!ok) continue
				if (!deletions.has(r)) deletions.set(r, { file: f.rel, decls: new Set() })
				deletions.get(r).decls.add(d)
				counts.move3++
				log.push(`3  ${f.rel.padEnd(15)} delete ${d.prop}: ${d.value}   ${r.prelude.replace(/\s+/g, ' ').slice(0, 70)}`)
			}
		}
	}
}

// Move 4: delete colour literals that never paint, because another rule
// always beats them. See "Move 4" in the header for what counts as proof.

// Every page that loads a target file, and the order it loads things in. A
// winner has to be loaded -- in the same relative order -- on all of them.
const TEMPLATES_DIR = join(ROOT, 'packages/noodle-web/src/noodle_web/templates')
const pageSheets = readdirSync(TEMPLATES_DIR).filter((n) => n.endsWith('.html'))
	.map((n) => [...readFileSync(join(TEMPLATES_DIR, n), 'utf8').matchAll(/href="\/static\/([^"?]+\.css)/g)].map((m) => m[1]))
	.filter((list) => list.some((x) => TARGETS.has(x)))
function winnerFileOk(winner, target) {
	return pageSheets.every((list) => {
		const t = list.indexOf(target)
		if (t === -1) return true
		const w = list.indexOf(winner)
		if (w === -1) return false
		return Math.sign(w - t) === Math.sign(linked.indexOf(winner) - linked.indexOf(target))
	})
}

// Classes the app puts on <html> or <body>. `:root body .x` only reaches `.x`
// below <body>, so a subject that could be <body> itself is not covered by it.
const ROOT_CLASSES = new Set(['.backstage-fullscreen', '.detail-pane-open', '.gantt-dragging', '.markdown-view',
	'.modal-open', '.no-animations', '.wb-linking', '.wb-row-drag-active', '.collab-chat-docked', '.is-joined',
	'.wb-note-drag-active', '.collab-join', '.gallery-body'])

/** A selector as compounds, subject last: [{ comb, tag, simples, pe }], or null if not understood. */
function compounds(sel) {
	const parts = []
	let depth = 0
	let cur = ''
	for (const c of sel.trim()) {
		if (c === '(' || c === '[') depth++
		if (c === ')' || c === ']') depth--
		if (/\s/.test(c) && depth === 0) { if (cur) parts.push(cur); cur = ''; continue }
		cur += c
	}
	if (cur) parts.push(cur)
	const out = []
	let comb = ' '
	for (const p of parts) {
		if (/^[>+~]$/.test(p)) { comb = p; continue }
		const c = { comb: out.length ? comb : null, tag: '*', simples: [], pe: '' }
		let rest = p
		const tag = /^([a-zA-Z][\w-]*|\*)/.exec(rest)
		if (tag) { c.tag = tag[1].toLowerCase(); rest = rest.slice(tag[1].length) }
		const re = /^(::?[\w-]+(\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))?|\.[\w-]+|#[\w-]+|\[[^\]]*\])/
		while (rest) {
			const m = re.exec(rest)
			if (!m) return null
			const tok = m[1]
			rest = rest.slice(tok.length)
			if (tok.startsWith('::') || /^:(before|after|placeholder)$/.test(tok)) c.pe = tok.replace(/^::?/, '::')
			else c.simples.push(tok.replace(/\s+/g, ' ').replace(/'/g, '"'))
		}
		out.push(c)
		comb = ' '
	}
	return out
}

/** Does compound `t` match every element that compound `s` matches, in every state? */
function compoundCovers(t, s) {
	if (t.pe !== s.pe) return false
	if (t.tag !== '*' && t.tag !== s.tag) return false
	return t.simples.every((x) => {
		if (s.simples.includes(x)) return true
		// :is()/:where() is satisfied when one alternative is a single compound `s` implies.
		const m = /^:(is|where)\((.*)\)$/.exec(x)
		if (!m) return false
		return splitSelectors(m[2]).some((alt) => {
			const a = compounds(alt)
			return a && a.length === 1 && compoundCovers(a[0], { ...s, pe: a[0].pe })
		})
	})
}

const isRootCompound = (c) => !c.pe && ((c.tag === '*' && c.simples.length === 1 && c.simples[0] === ':root') ||
	(['html', 'body'].includes(c.tag) && !c.simples.length))

/** Does selector `t` match every element selector `s` matches, in every state? */
function selectorCovers(t, s) {
	const T = compounds(t)
	const S = compounds(s)
	if (!T || !S) return false
	if (!compoundCovers(T.at(-1), S.at(-1))) return false
	// The compounds S guarantees are ancestors: left over descendant/child combinators.
	const sAnc = []
	for (let i = S.length - 1; i > 0; i--) {
		if (!/^[ >]$/.test(S[i].comb)) break
		sAnc.unshift(S[i - 1])
	}
	let usesRoot = false
	let j = sAnc.length - 1
	for (let i = T.length - 2; i >= 0; i--) {
		if (T[i + 1].comb !== ' ') return false // only descendant combinators are provable here
		if (isRootCompound(T[i])) { usesRoot = true; continue }
		while (j >= 0 && !compoundCovers(T[i], sAnc[j])) j--
		if (j < 0) return false
		j--
	}
	if (usesRoot) {
		// `:root body X` needs X to be strictly inside <body>: a subject or an
		// ancestor named by a class or id the app never puts on <html>/<body>.
		const subj = S.at(-1)
		if (['html', 'body'].includes(subj.tag)) return false
		const inside = [subj, ...sAnc.slice(1)].some((c) => c.simples.some((x) => /^[.#]/.test(x) && !ROOT_CLASSES.has(x)))
		if (!inside) return false
	}
	return true
}

/** The longhands a declaration sets, for deciding whether a winner covers all of them. */
function longhands(prop) {
	const sides = ['top', 'right', 'bottom', 'left']
	const box = (parts) => sides.flatMap((sd) => parts.map((p) => `border-${sd}-${p}`))
	if (prop === 'border') return box(['width', 'style', 'color'])
	if (/^border-(color|width|style)$/.test(prop)) return box([prop.slice(7)])
	let m = /^border-(top|right|bottom|left)$/.exec(prop)
	if (m) return ['width', 'style', 'color'].map((p) => `border-${m[1]}-${p}`)
	if (prop === 'background') return ['background-color', 'background-image', 'background-position', 'background-size',
		'background-repeat', 'background-attachment', 'background-origin', 'background-clip']
	if (prop === 'outline') return ['outline-color', 'outline-style', 'outline-width']
	return [prop]
}

if (moves.has(4)) {
	const byLonghand = new Map()
	for (const e of all) {
		for (const lh of longhands(e.prop)) {
			if (!byLonghand.has(lh)) byLonghand.set(lh, [])
			byLonghand.get(lh).push(e)
		}
	}
	for (const f of files) {
		if (!TARGETS.has(f.rel)) continue
		for (const r of f.rules) {
			if (only && !only.test(r.prelude)) continue
			const sels = splitSelectors(r.prelude)
			for (const d of r.decls) {
				if (d.prop.startsWith('--') || newValue.has(d) || deletions.get(r)?.decls.has(d)) continue
				if (!familyOf(d.prop)) continue
				const masked = d.value.replace(/var\((?:[^()]|\([^()]*\))*\)/g, (m) => ' '.repeat(m.length))
				if (![...masked.matchAll(LITERAL_RE)].some((m) => norm(m[0]))) continue
				const proof = []
				const winnerFor = (sel, lh) => {
					const me = all.find((e) => e.decl === d && e.sel === sel)
					return (byLonghand.get(lh) ?? []).find((e) => {
						if (e.decl === d) return false
						if (e.rule.at && e.rule.at !== r.at) return false // conditional: not always in force
						if (d.important && !e.decl.important) return false
						if (!winnerFileOk(e.file, f.rel)) return false
						if (deletions.get(e.rule)?.decls.has(e.decl)) return false // going too
						const c = cmpSpec(e.spec, me.spec)
						const wins = (e.decl.important && !d.important) || c > 0 || (c === 0 && e.seq > me.seq)
						return wins && selectorCovers(e.sel, sel)
					})
				}
				const covered = (lhs) => sels.every((sel) => lhs.every((lh) => {
					const w = winnerFor(sel, lh)
					if (w) proof.push(`${lh} <- ${w.sel} { ${w.prop}: ${(newValue.get(w.decl) ?? w.decl.value).slice(0, 40)} } (${w.file})`)
					return !!w
				}))
				// A border/outline shorthand whose *colour* always loses, while its
				// width and style still paint: drop just the colour from it. The
				// colour longhand then resets to currentColor, which also loses.
				const colourLonghands = longhands(d.prop).filter((lh) => lh.endsWith('-color'))
				if (/^(border(-(top|right|bottom|left))?|outline)$/.test(d.prop) && colourLonghands.length &&
					!covered(longhands(d.prop)) && (proof.length = 0, covered(colourLonghands))) {
					const stripped = d.value.replace(LITERAL_RE, (m) => (norm(m) ? '' : m)).replace(/\s+/g, ' ').trim()
					if (stripped && !/^(none|0|hidden)$/.test(stripped)) {
						newValue.set(d, stripped)
						counts.move4++
						log.push(`4  ${f.rel.padEnd(15)} ${d.prop}: ${d.value} -> ${stripped}   ${r.prelude.replace(/\s+/g, ' ').slice(0, 70)}`)
						if (verbose) for (const p of new Set(proof)) log.push(`       ${p}`)
					}
					continue
				}
				proof.length = 0
				const dead = sels.every((sel) => {
					const me = all.find((e) => e.decl === d && e.sel === sel)
					return longhands(d.prop).every((lh) => {
						const w = (byLonghand.get(lh) ?? []).find((e) => {
							if (e.decl === d) return false
							if (e.rule.at && e.rule.at !== r.at) return false // conditional: not always in force
							if (d.important && !e.decl.important) return false
							if (!winnerFileOk(e.file, f.rel)) return false
							if (deletions.get(e.rule)?.decls.has(e.decl)) return false // going too
							const c = cmpSpec(e.spec, me.spec)
							const wins = (e.decl.important && !d.important) || c > 0 || (c === 0 && e.seq > me.seq)
							return wins && selectorCovers(e.sel, sel)
						})
						if (w) proof.push(`${lh} <- ${w.sel} { ${w.prop}: ${(newValue.get(w.decl) ?? w.decl.value).slice(0, 40)} } (${w.file})`)
						return !!w
					})
				})
				if (!dead) continue
				if (!deletions.has(r)) deletions.set(r, { file: f.rel, decls: new Set() })
				deletions.get(r).decls.add(d)
				counts.move4++
				log.push(`4  ${f.rel.padEnd(15)} delete ${d.prop}: ${d.value}   ${r.prelude.replace(/\s+/g, ' ').slice(0, 70)}`)
				if (verbose) for (const p of new Set(proof)) log.push(`       ${p}`)
			}
		}
	}
}

// Leftover dark literals that move 3 deletes are not left over.
const deletedDecls = new Set([...deletions.values()].flatMap((x) => [...x.decls]))

// --- Apply --------------------------------------------------------------------

for (const f of files) {
	if (!TARGETS.has(f.rel)) continue
	const list = []
	for (const r of f.rules) {
		const del = deletions.get(r)
		if (del && del.decls.size === r.decls.length) {
			// The whole rule goes: from its selector to its brace, plus the line
			// break it leaves behind. A comment before it stays.
			let start = r.preludeStart
			while (start > 0 && /[ \t]/.test(f.text[start - 1])) start--
			let end = r.bodyEnd + 1
			if (f.text[end] === '\n') end++
			if (f.text[start - 1] === '\n' && f.text[end] === '\n') end++
			list.push({ start, end, text: '' })
			counts.rulesEmptied++
			continue
		}
		for (const d of r.decls) {
			if (del?.decls.has(d)) {
				// The declaration and its `;`, with the indentation and line break
				// before it -- but not a comment that precedes it.
				let start = d.declStart + (f.bare.slice(d.declStart, d.declEnd).length - f.bare.slice(d.declStart, d.declEnd).trimStart().length)
				while (/[ \t]/.test(f.text[start - 1])) start--
				if (f.text[start - 1] === '\n') start--
				const end = f.text[d.declEnd] === ';' ? d.declEnd + 1 : d.declEnd
				list.push({ start, end, text: '' })
			} else if (newValue.has(d)) {
				list.push({ start: d.valueStart, end: d.valueEnd, text: newValue.get(d) })
			}
		}
	}
	if (!list.length) continue
	list.sort((a, b) => b.start - a.start)
	let out = f.text
	for (const e of list) out = out.slice(0, e.start) + e.text + out.slice(e.end)
	if (!dryRun && !report && !listChanged) writeFileSync(join(STATIC_DIR, f.rel), out)
}

if (listChanged) {
	const touched = new Set()
	for (const f of files) for (const r of f.rules) {
		if (deletions.has(r) || r.decls.some((d) => newValue.has(d))) {
			for (const sel of splitSelectors(r.prelude)) touched.add(sel.replace(DARK_PREFIX, ''))
		}
	}
	console.log([...touched].join('\n'))
	process.exit(0)
}
if (report) {
	const rows = leftovers.filter((l) => !deletedDecls.has(l.decl)).map(({ decl, ...rest }) => rest)
	console.log(JSON.stringify(rows, null, 1))
	process.exit(0)
}
if (verbose || dryRun) for (const l of log) console.log(l)
console.log(`\nmove 1 (light literal -> token): ${counts.move1}`)
console.log(`move 2 (dark literal -> token):  ${counts.move2}`)
console.log(`move 3 (dark declaration deleted): ${counts.move3}`)
console.log(`move 4 (overridden everywhere: deleted, or colour dropped from a border shorthand): ${counts.move4}`)
console.log(`${counts.rulesEmptied} rule(s) removed entirely`)
console.log(dryRun ? '\n(dry run: nothing written)' : '')
