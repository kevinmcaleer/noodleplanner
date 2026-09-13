#!/usr/bin/env node
/**
 * Remove `var()` fallbacks that can never fire (#1194).
 *
 * `var(--np-accent, #108BB9)` renders the fallback only when `--np-accent` is
 * undefined. Where the token is declared on `:root` it always resolves, so the
 * literal is dead — and most of these encode the superseded #1024 blue
 * identity, which makes them worse than merely dead: if a token ever went
 * missing the app would silently revert to the old palette rather than failing
 * visibly.
 *
 * Safety rule: a fallback is removed only when the token is declared in a
 * `:root` rule of a stylesheet `index.html` links. `:root` applies in both
 * themes, so a `[data-theme="dark"]` override changes the value but never
 * leaves it undefined. A token declared *only* under `[data-theme="dark"]`
 * keeps its fallback, because in the light theme that fallback is what paints.
 *
 * Usage:
 *   node scripts/strip-dead-fallbacks.mjs --dry-run
 *   node scripts/strip-dead-fallbacks.mjs
 *
 * Verify with a before/after capture — see scripts/compare_screens.py.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const STATIC_DIR = join(ROOT, 'packages/noodle-web/src/noodle_web/static')
const INDEX = join(ROOT, 'packages/noodle-web/src/noodle_web/templates/index.html')

const dryRun = process.argv.includes('--dry-run')
const linked = [...readFileSync(INDEX, 'utf8').matchAll(/href="\/static\/([^"?]+\.css)/g)].map((m) => m[1])
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')

// --- Tokens declared at :root by a linked stylesheet.
const alwaysDefined = new Set()
for (const rel of linked) {
	const css = stripComments(readFileSync(join(STATIC_DIR, rel), 'utf8'))
	for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		if (!/(^|,)\s*:root\s*(,|$)/.test(m[1].trim())) continue
		for (const decl of m[2].split(';')) {
			const i = decl.indexOf(':')
			if (i === -1) continue
			const prop = decl.slice(0, i).trim()
			if (prop.startsWith('--')) alwaysDefined.add(prop)
		}
	}
}

/**
 * Rewrite `var(--x, fallback)` -> `var(--x)` for always-defined --x.
 *
 * Hand-walked rather than done with a regex: a fallback can itself contain a
 * var() (`var(--a, var(--b, #fff))`), and a regex that handles one nesting
 * level silently mangles two.
 */
function strip(css) {
	let out = ''
	let i = 0
	let removed = 0

	while (i < css.length) {
		if (!css.startsWith('var(', i)) {
			out += css[i]
			i++
			continue
		}
		// Find this var()'s matching close paren.
		let depth = 0
		let end = i
		for (; end < css.length; end++) {
			if (css[end] === '(') depth++
			else if (css[end] === ')') {
				depth--
				if (depth === 0) { end++; break }
			}
		}
		const whole = css.slice(i, end)
		const inner = whole.slice(4, -1)
		const comma = inner.indexOf(',')
		if (comma === -1) {
			// No fallback, but the name may still wrap a nested var(): recurse.
			out += whole
			i = end
			continue
		}
		const name = inner.slice(0, comma).trim()
		const fallback = inner.slice(comma + 1)
		if (/^--[a-zA-Z][a-zA-Z0-9-]*$/.test(name) && alwaysDefined.has(name)) {
			out += `var(${name})`
			removed++
			i = end
			continue
		}
		// Kept: recurse into the fallback, which may hold its own dead var().
		const nested = strip(fallback)
		out += `var(${name},${nested.css})`
		removed += nested.removed
		i = end
	}
	return { css: out, removed }
}

let total = 0
const perFile = []
for (const rel of linked) {
	const path = join(STATIC_DIR, rel)
	const original = readFileSync(path, 'utf8')
	const { css, removed } = strip(original)
	if (!removed) continue
	if (!dryRun) writeFileSync(path, css)
	perFile.push([rel, removed])
	total += removed
}

for (const [file, n] of perFile.sort((a, b) => b[1] - a[1])) {
	console.log(String(n).padStart(5), file)
}
console.log(`\n${total} dead fallback(s) ${dryRun ? 'found' : 'removed'} across ${perFile.length} file(s)`)
console.log(`${alwaysDefined.size} tokens are declared at :root and always resolve`)
