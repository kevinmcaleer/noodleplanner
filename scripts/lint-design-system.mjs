#!/usr/bin/env node
/**
 * Design-system linter (#1195).
 *
 * Checks the stylesheets index.html actually links for the four things the
 * #1187 audit found, and that bands 2-4 are working through:
 *
 *   raw-colour             a colour literal where a token should be
 *   off-scale-spacing      a margin/padding/gap value not on the scale
 *   unpaired-outline-none  a focus outline removed with nothing in its place
 *   token-outside-canonical  a --np-* declared at global scope outside
 *                          visual-system.css
 *
 * ## Why this is a ratchet and not a threshold
 *
 * There are ~2,600 pre-existing violations. A linter that fails on all of them
 * on day one gets switched off within a week, and a warn-only linter that
 * cannot fail is read once and then ignored. So this compares against a
 * committed baseline of per-file counts and fails only when a count goes *up*
 * or a new file appears. Existing debt is tolerated; adding to it is not, and
 * paying it down lowers the baseline.
 *
 * Usage:
 *   node scripts/lint-design-system.mjs                    check against the baseline
 *   node scripts/lint-design-system.mjs --update-baseline  re-record it
 *   node scripts/lint-design-system.mjs --list <rule>      every violation of one rule
 *   node scripts/lint-design-system.mjs --json
 *
 * Re-baselining is a normal thing to do after a refactor moves code between
 * files. It is not a way to sneak a violation past review -- the baseline is a
 * committed file, so the diff shows a number going up.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const STATIC_DIR = join(ROOT, 'packages/noodle-web/src/noodle_web/static')
const INDEX = join(ROOT, 'packages/noodle-web/src/noodle_web/templates/index.html')
const CANONICAL = 'packages/noodle-web/src/noodle_web/static/visual-system.css'
const BASELINE = join(ROOT, 'ci/design-system-baseline.json')

const args = process.argv.slice(2)
const updating = args.includes('--update-baseline')
const asJson = args.includes('--json')
const listRule = args.includes('--list') ? args[args.indexOf('--list') + 1] : null

// --- Scope: what the browser loads, in load order. Anything else is not the
// app, and linting it produces findings nobody can act on -- static/style.css
// alone would contribute thousands.
const linked = [...readFileSync(INDEX, 'utf8').matchAll(/href="\/static\/([^"?]+\.css)/g)].map((m) => m[1])

const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))

/** Split a stylesheet into { selector, body, line } for every rule. */
function rules(css) {
	const out = []
	let depth = 0
	let buf = ''
	let start = 0
	let line = 1
	const stack = []
	for (let i = 0; i < css.length; i++) {
		const c = css[i]
		if (c === '\n') line++
		if (c === '{') {
			stack.push({ prelude: buf.trim(), line })
			buf = ''
			depth++
			start = i + 1
			continue
		}
		if (c === '}') {
			const frame = stack.pop()
			depth--
			if (frame && !frame.prelude.startsWith('@')) {
				out.push({ selector: frame.prelude, body: css.slice(start, i), line: frame.line })
			}
			buf = ''
			start = i + 1
			continue
		}
		buf += c
	}
	return out
}

/** Declarations of one rule, as { prop, value }. */
function declarations(body) {
	const out = []
	for (const raw of body.split(';')) {
		const i = raw.indexOf(':')
		if (i === -1) continue
		const prop = raw.slice(0, i).trim()
		// A nested rule's leftovers can look like a declaration; property names
		// never contain a brace or a dot.
		if (!prop || /[{}.#>]/.test(prop)) continue
		out.push({ prop, value: raw.slice(i + 1).trim() })
	}
	return out
}

// --- Allowlists. Each is a real category that has no business behind a token,
// not a way of quieting an inconvenient finding.
//
// `rules` says which findings an entry exempts, and every entry must name it.
// Without that these were colour-only in practice but read as blanket: the
// syntax-theme entry would have gone on to excuse `.line-numbers`' padding
// too, which is nothing to do with why it exists.
const ALLOW = [
	{
		// The editor's syntax highlighting is a VS Code-derived theme of ~30
		// rules on a permanently dark editor surface. It wants tokenising as a
		// set, not one rule at a time, and it is not the UI palette.
		why: 'editor syntax theme',
		rules: ['raw-colour'],
		match: ({ file, selector }) => file.endsWith('views/gantt.css') && /\.syntax-|\.line-numbers|\.editor-|\.section-fold/.test(selector),
	},
	{
		// The whiteboard note header is a flex row of a title and six icon
		// buttons inside a note whose width is plan data, so its free space is
		// measured in single pixels. Snapping gap 6 -> 8 and padding 10 -> 12
		// walked the button row ~2px left, far enough to put
		// .wb-note-link-handle under the header's own midpoint -- so grabbing
		// the middle of the header started a link drag instead of a move, and
		// a note dragged to the parking lot was silently not parked. Caught by
		// tests/ui/test_whiteboard_parking_lot.py. The scale does not get a
		// vote on a value that is load-bearing for hit-testing.
		why: 'whiteboard note header hit-testing',
		rules: ['off-scale-spacing'],
		match: ({ file, selector }) => file.endsWith('views/whiteboard.css') && /^\.wb-note-header$/.test(selector.trim()),
	},
	{
		// Chart series, axis and grid colours are data encodings handed to a
		// canvas API, not surfaces. They are already tokens in base.css.
		why: 'chart series palette',
		rules: ['raw-colour'],
		match: ({ file, selector }) => file.endsWith('base.css') && /:root|\[data-theme/.test(selector),
	},
	{
		// The canonical layer is where colour literals are supposed to live.
		why: 'canonical token layer',
		rules: ['raw-colour'],
		match: ({ file }) => file === CANONICAL,
	},
	{
		// A named RAG/priority hue is the meaning of the element, and the
		// palette for it is a product decision rather than a token.
		why: 'RAG / traffic-light encoding',
		rules: ['raw-colour'],
		match: ({ selector }) => /\b(rag|status)-(red|amber|green)\b|\.rag-badge|\.status-badge/.test(selector),
	},
]

const COLOUR_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/
const COLOUR_PROPS = /^(color|background|background-color|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|fill|stroke|box-shadow|text-shadow|caret-color|column-rule(-color)?|text-decoration-color)$/

const SPACING_PROPS = new Set([
	'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
	'margin-block', 'margin-inline',
	'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
	'padding-block', 'padding-inline',
	'gap', 'row-gap', 'column-gap',
])
// The rule is the 4px grid, which is what the epic actually asked for, not the
// named --np-space-* steps. Those are the preferred vocabulary and cover the
// common cases, but plenty of on-grid values outside them are load-bearing
// rather than sloppy: `padding-bottom: 36px` matches the fixed status bar's
// height and `padding-right: 44px` is clearance for the icon inside a search
// input. Flagging those forever would mean the count could never reach zero,
// and a rule that can never be satisfied gets ignored.
//
// 0, 1px and 2px are finer than the grid and legitimately so -- a hairline gap
// is not a spacing step, and rounding it to 4px doubles it.
const FINE_PX = new Set([0, 1, 2])
const onGrid = (n) => FINE_PX.has(Math.abs(n)) || Math.abs(n) % 4 === 0

function isAllowed(rule, context) {
	return ALLOW.find((a) => a.rules.includes(rule) && a.match(context))
}

function lint() {
	const findings = []
	for (const rel of linked) {
		const abs = join(STATIC_DIR, rel)
		const file = relative(ROOT, abs)
		const css = stripComments(readFileSync(abs, 'utf8'))
		for (const rule of rules(css)) {
			const context = { file, selector: rule.selector }
			const decls = declarations(rule.body)

			for (const { prop, value } of decls) {
				// --- token-outside-canonical
				if (prop.startsWith('--np-')) {
					const global = /(^|,)\s*:root\s*(,|$)/.test(rule.selector) ||
						/\[data-theme=["']?dark["']?\]\s*(,|$)/.test(rule.selector)
					if (global && file !== CANONICAL) {
						findings.push({ rule: 'token-outside-canonical', file, line: rule.line, detail: `${prop} declared at global scope`, selector: rule.selector })
					}
					continue // a token's own value is not a raw-colour finding
				}

				// --- raw-colour
				if (!isAllowed('raw-colour', context) && COLOUR_PROPS.test(prop) && COLOUR_RE.test(value)) {
					// A var() with a literal fallback is indirected already; the
					// fallback only paints if the token is missing, which the
					// audit reports separately.
					const withoutVars = value.replace(/var\([^)]*\)/g, '')
					if (COLOUR_RE.test(withoutVars)) {
						findings.push({ rule: 'raw-colour', file, line: rule.line, detail: `${prop}: ${value.slice(0, 60)}`, selector: rule.selector })
					}
				}

				// --- off-scale-spacing
				if (!isAllowed('off-scale-spacing', context) &&
					SPACING_PROPS.has(prop) && !/var\(|calc\(|clamp\(|auto|%/.test(value)) {
					for (const m of value.matchAll(/(-?\d*\.?\d+)(px)?\b/g)) {
						const n = parseFloat(m[1])
						if (m[2] !== 'px' && n !== 0) continue // em/rem/unitless: not this rule's business
						if (!onGrid(n)) {
							findings.push({ rule: 'off-scale-spacing', file, line: rule.line, detail: `${prop}: ${value.slice(0, 40)} (${m[0]})`, selector: rule.selector })
						}
					}
				}
			}

			// --- unpaired-outline-none. Only on a focus rule: `outline: none`
			// on a resting state is normal, and the global :focus-visible ring
			// is a box-shadow precisely so it survives that.
			// `:not(:focus-visible)` is the correct way to suppress a ring for a
			// pointer click while keeping it for the keyboard, so removing the
			// outline there is the whole point of the rule, not a defect.
			if (/:focus/.test(rule.selector) && !/:not\(\s*:focus-visible\s*\)/.test(rule.selector)) {
				const killsOutline = decls.some((d) => d.prop === 'outline' && /^(none|0)\b/.test(d.value))
				const givesSomething = decls.some((d) =>
					(d.prop === 'box-shadow' && d.value !== 'none') ||
					/^border/.test(d.prop) ||
					/^background/.test(d.prop) ||
					(d.prop === 'outline' && !/^(none|0)\b/.test(d.value)))
				if (killsOutline && !givesSomething) {
					findings.push({ rule: 'unpaired-outline-none', file, line: rule.line, detail: 'outline removed on focus with no replacement', selector: rule.selector })
				}
			}
		}
	}
	return findings
}

const findings = lint()

// --- The baseline is keyed rule -> file -> finding -> count, not a bare total.
// A total tells you something got worse; this tells you what. It also makes the
// baseline diff readable: paying down debt deletes lines, and a violation that
// slips past review shows up as a line someone added.
//
// Line numbers are deliberately not part of the key. Including them would
// invalidate the whole file's baseline every time anyone inserted a rule above.
const counts = {}
for (const f of findings) {
	counts[f.rule] ??= {}
	counts[f.rule][f.file] ??= {}
	counts[f.rule][f.file][f.detail] = (counts[f.rule][f.file][f.detail] ?? 0) + 1
}

const sortDeep = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))
	.map(([k, v]) => [k, v && typeof v === 'object' ? sortDeep(v) : v]))

if (listRule) {
	for (const f of findings.filter((x) => x.rule === listRule)) {
		console.log(`${f.file}:${f.line}  ${f.selector.slice(0, 50)}\n    ${f.detail}`)
	}
	console.log(`\n${findings.filter((x) => x.rule === listRule).length} ${listRule} finding(s)`)
	process.exit(0)
}

if (updating) {
	writeFileSync(BASELINE, JSON.stringify({
		note: 'Known design-system violations, keyed rule -> file -> finding -> count. The linter fails when a count goes up or a new finding appears. Regenerate with: node scripts/lint-design-system.mjs --update-baseline',
		counts: sortDeep(counts),
	}, null, 2) + '\n')
	console.log(`Baseline written: ${findings.length} finding(s) across ${Object.keys(counts).length} rule(s).`)
	process.exit(0)
}

if (!existsSync(BASELINE)) {
	console.error('No baseline. Run: node scripts/lint-design-system.mjs --update-baseline')
	process.exit(2)
}
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')).counts

const regressions = []
const improvements = []
for (const rule of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
	const nowFiles = counts[rule] ?? {}
	const wasFiles = baseline[rule] ?? {}
	for (const file of new Set([...Object.keys(nowFiles), ...Object.keys(wasFiles)])) {
		const now = nowFiles[file] ?? {}
		const was = wasFiles[file] ?? {}
		for (const detail of new Set([...Object.keys(now), ...Object.keys(was)])) {
			const n = now[detail] ?? 0
			const w = was[detail] ?? 0
			if (n > w) regressions.push({ rule, file, detail, was: w, now: n })
			else if (n < w) improvements.push({ rule, file, detail, was: w, now: n })
		}
	}
}
const lineFor = (rule, file, detail) => {
	const hit = findings.find((f) => f.rule === rule && f.file === file && f.detail === detail)
	return hit ? hit.line : '?'
}

if (asJson) {
	console.log(JSON.stringify({ counts, regressions, improvements, total: findings.length }, null, 2))
	process.exit(regressions.length ? 1 : 0)
}

const total = findings.length
const baselineTotal = Object.values(baseline).reduce(
	(n, files) => n + Object.values(files).reduce(
		(m, details) => m + Object.values(details).reduce((k, v) => k + v, 0), 0), 0)
console.log(`Design-system lint: ${total} finding(s) against a baseline of ${baselineTotal}.`)
for (const rule of Object.keys(counts).sort()) {
	const n = Object.values(counts[rule]).reduce(
		(a, details) => a + Object.values(details).reduce((k, v) => k + v, 0), 0)
	console.log(`  ${rule.padEnd(24)} ${n}`)
}

if (improvements.length) {
	console.log(`\n${improvements.length} file(s) improved. Lower the baseline so the gain is held:`)
	console.log('  node scripts/lint-design-system.mjs --update-baseline')
	for (const i of improvements.slice(0, 10)) {
		console.log(`  ${i.rule} ${i.file}: ${i.detail} (${i.was} -> ${i.now})`)
	}
	if (improvements.length > 10) console.log(`  ...and ${improvements.length - 10} more`)
}

if (regressions.length) {
	console.log('\nNew violations:')
	for (const r of regressions) {
		const where = `${r.file}:${lineFor(r.rule, r.file, r.detail)}`
		const times = r.was === 0 ? '' : ` (${r.was} -> ${r.now})`
		console.log(`  ${r.rule}\n      ${where}  ${r.detail}${times}`)
	}
	console.log('\nUse a token from docs/design/tokens.md, or if the value genuinely')
	console.log('belongs outside the system, add a case to ALLOW in this script with a')
	console.log('reason. Re-baselining is for refactors that move code between files.')
	process.exit(1)
}

console.log('\nNo new violations.')
