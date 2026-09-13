#!/usr/bin/env node
/**
 * Delete `cursor: pointer` where the interactive base layer already says it (#1194).
 *
 * visual-system.css now carries a zero-specificity `:where(button, [role=button],
 * summary, label[for], select, a[href], area[href]) { cursor: pointer }`. Every
 * declaration in a component stylesheet that repeats it on one of those
 * elements is now noise.
 *
 * The hard part is knowing whether a given rule's selector actually matches
 * one of those elements. `.kanban-btn` might be on a <button> or on a <div>,
 * and a static reading of the CSS cannot tell. So this does not try: it
 * removes the declaration wherever the selector *names* one of the base
 * elements, or ends in a class whose rule also sets `border: none` and a
 * background -- the shape of a styled <button> -- and leaves everything else.
 *
 * That is deliberately incomplete. The check that matters is not how many were
 * removed, it is that every element's computed `cursor` is byte-identical
 * before and after, which scratchpad/cursors.py measures across all 39 views.
 * A removal that turns out to have been wrong shows up there as a changed
 * value, not as a subtly wrong-feeling UI three months later.
 *
 * Usage:
 *   node scripts/drop-redundant-cursor.mjs --dry-run
 *   node scripts/drop-redundant-cursor.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const STATIC_DIR = join(ROOT, 'packages/noodle-web/src/noodle_web/static')
const INDEX = join(ROOT, 'packages/noodle-web/src/noodle_web/templates/index.html')

const dryRun = process.argv.includes('--dry-run')
const linked = [...readFileSync(INDEX, 'utf8').matchAll(/href="\/static\/([^"?]+\.css)/g)].map((m) => m[1])
const SKIP_FILES = new Set(['visual-system.css'])

// The selector names an element the base layer covers. This list has to stay
// in step with the `:where(...)` in visual-system.css -- getting it wrong in
// the generous direction deletes a declaration nothing replaces. `select` is
// the case that proved it: it was in this list while the base layer still
// covered selects, and when the base layer dropped it (the app styles no
// select cursor anywhere, so covering it would have been a design decision
// rather than a gap-fill) every select silently reverted to the default
// arrow. The cursor fingerprint caught it; static reading of the CSS did not.
const NAMES_BASE_ELEMENT = /(^|[\s>+~,])(button|summary|a|area)\b|\[role=["']?button["']?\]|input\[type=["']?(button|submit|reset)["']?\]/

let total = 0
let skipped = 0
const perFile = []

for (const rel of linked) {
	if (SKIP_FILES.has(rel)) continue
	const path = join(STATIC_DIR, rel)
	const original = readFileSync(path, 'utf8')
	let count = 0

	const out = original.replace(/(?<=^|[{};])(\s*)([^{};@]+?)(\s*)\{([^{}]*)\}/g,
		(whole, ws1, selector, ws2, body) => {
			const sel = selector.trim()
			if (!sel || sel.startsWith('@')) return whole
			// A disabled/aria-disabled rule wants not-allowed, and a state rule
			// may be deliberately reasserting pointer over something else.
			if (/:disabled|\[aria-disabled|:not\(/.test(sel)) return whole

			const decls = body.split(';')
			const keep = []
			let dropped = false
			for (const d of decls) {
				const i = d.indexOf(':')
				if (i === -1) { keep.push(d); continue }
				const prop = d.slice(0, i).trim().toLowerCase()
				const value = d.slice(i + 1).trim().toLowerCase()
				if (prop === 'cursor' && value === 'pointer') {
					if (NAMES_BASE_ELEMENT.test(sel)) { dropped = true; count++; continue }
					skipped++
				}
				keep.push(d)
			}
			if (!dropped) return whole
			if (!keep.some((d) => d.trim())) return '' // the rule said nothing else
			return `${ws1}${selector}${ws2}{${keep.join(';')}}`
		})

	if (!count) continue
	if (!dryRun) writeFileSync(path, out)
	perFile.push([rel, count])
	total += count
}

for (const [file, n] of perFile.sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(5), file)
console.log(`\n${total} redundant \`cursor: pointer\` ${dryRun ? 'would be' : ''} removed`)
console.log(`${skipped} left in place: the selector does not name an element the base layer covers`)
