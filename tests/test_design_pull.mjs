/**
 * `npm run design:pull` reads Penpot's token library into docs/design/tokens/
 * (#1319). These pin the three things that make a pull safe to run
 * unattended:
 *
 * - every source Penpot can give (the MCP plugin's dump, a `get-file`
 *   response, a single-file export) turns into the same files;
 * - a pull with no design change writes nothing, even though Penpot returns
 *   tokens in its own order and with its own theme ids, so the workflow opens
 *   no pull request;
 * - a real change is written, regenerates the CSS, and is reported token by
 *   token, a removal loudest of all.
 *
 * The fixtures are built from the committed export, so they follow it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, readdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TOKENS_DIR, STYLESHEET, flattenSet, check } from '../scripts/design-tokens.mjs'
import { readPenpot, exportFiles, describeChanges, pull, fetchFromPenpot, PLUGIN_DUMP } from '../scripts/design-pull.mjs'

const read = (dir, f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))

function copies() {
	const root = mkdtempSync(join(tmpdir(), 'design-pull-'))
	const dir = join(root, 'tokens')
	cpSync(TOKENS_DIR, dir, { recursive: true })
	const css = join(root, 'visual-system.css')
	copyFileSync(STYLESHEET, css)
	return { dir, css }
}

// What the plugin's execute_code returns for the committed tokens, in a
// different order and with Penpot's own theme ids, the way the real one
// comes back.
function pluginDump(dir = TOKENS_DIR) {
	const meta = read(dir, '$metadata.json')
	const sets = meta.tokenSetOrder.map((name) => ({
		name,
		tokens: flattenSet(read(dir, `${name}.json`)).reverse()
			.map((t) => ({ name: t.path, type: t.type, value: t.value, description: t.description })),
	}))
	const themes = read(dir, '$themes.json').map((th, i) => ({
		group: th.group, name: th.name, description: '', isSource: false,
		id: `penpot-${i}`, sets: Object.keys(th.selectedTokenSets),
	}))
	themes.push({ group: '', name: '__PENPOT__HIDDEN__TOKEN__THEME__', id: 'x', sets: [] })
	return { source: 'penpot-plugin', sets, themes }
}

// Penpot's single-file DTCG export, which get-file returns as data.tokensLib.
function singleFile(dir = TOKENS_DIR) {
	const meta = read(dir, '$metadata.json')
	const lib = Object.fromEntries(meta.tokenSetOrder.map((n) => [n, read(dir, `${n}.json`)]))
	lib.$themes = read(dir, '$themes.json').map((th) => ({ ...th, id: 'other-id' }))
	lib.$metadata = { ...meta, activeThemes: [], activeSets: [] }
	return lib
}

function writtenAsCommitted(files, dir = TOKENS_DIR) {
	for (const [file, text] of Object.entries(files)) {
		assert.equal(text, readFileSync(join(dir, file), 'utf8'), `${file} differs from the committed export`)
	}
	assert.deepEqual(Object.keys(files).sort(), readdirSync(dir).filter((f) => f.endsWith('.json')).sort())
}

test('a plugin dump of the committed tokens writes the committed files byte for byte', () => {
	writtenAsCommitted(exportFiles(readPenpot(pluginDump())))
})

test('so does the dump as the plugin returns it, a JSON string', () => {
	writtenAsCommitted(exportFiles(readPenpot(JSON.stringify(pluginDump()))))
})

test('a get-file response and a single-file export write the committed files too', () => {
	writtenAsCommitted(exportFiles(readPenpot({ id: 'f', data: { tokensLib: singleFile() } })))
	writtenAsCommitted(exportFiles(readPenpot(singleFile())))
})

test('a pull with no design change reports nothing and writes nothing', async () => {
	const { dir, css } = copies()
	const before = readFileSync(css, 'utf8')
	const { changed, changes } = await pull({ source: pluginDump(), dir, stylesheet: css, log: () => {} })
	assert.equal(changed, false)
	assert.deepEqual(changes, [])
	assert.equal(readFileSync(css, 'utf8'), before)
})

test('a changed, added and removed token is reported, written and regenerated', async () => {
	const { dir, css } = copies()
	const dump = pluginDump()
	const light = dump.sets.find((s) => s.name === 'color-light').tokens
	light.find((t) => t.name === 'accent').value = '#EEB62B'
	light.push({ name: 'brand-new', type: 'color', value: '#123456', description: '' })
	const core = dump.sets.find((s) => s.name === 'core')
	core.tokens = core.tokens.filter((t) => t.name !== 'space-64')

	const { changed, changes } = await pull({ source: dump, dir, stylesheet: css, log: () => {} })
	assert.equal(changed, true)
	assert.ok(changes.includes('color-light: changed accent: "#EDB52A" -> "#EEB62B"'), changes.join('\n'))
	assert.ok(changes.includes('color-light: added brand-new'))
	assert.ok(changes.includes('core: REMOVED space-64'))

	const written = read(dir, 'color-light.json')
	assert.equal(written.accent.$value, '#EEB62B')
	assert.equal(Object.keys(written).at(-1), 'brand-new', 'a new token goes at the end of its set')
	const out = readFileSync(css, 'utf8')
	assert.match(out, /--np-accent: #EEB62B;/)
	assert.match(out, /--np-brand-new: #123456;/)
	assert.doesNotMatch(out, /--np-space-64:/)
	assert.deepEqual(check({ dir, stylesheet: css }), [])
})

test('--check mode reports a change but writes nothing', async () => {
	const { dir, css } = copies()
	const dump = pluginDump()
	dump.sets[0].tokens[0].value = '999px'
	const { changed } = await pull({ source: dump, dir, stylesheet: css, write: false, log: () => {} })
	assert.equal(changed, true)
	assert.equal(readFileSync(join(dir, 'core.json'), 'utf8'), readFileSync(join(TOKENS_DIR, 'core.json'), 'utf8'))
})

test('a set that is gone from Penpot is reported as removed', () => {
	const dump = pluginDump()
	dump.sets = dump.sets.filter((s) => s.name !== 'color-dark')
	const changes = describeChanges(exportFiles(readPenpot(dump)))
	assert.ok(changes.some((c) => c.startsWith('color-dark.json: REMOVED')), changes.join('\n'))
})

test('the RPC fetch sends the access token and reads data.tokensLib', async () => {
	let seen
	const fetchImpl = async (url, opts) => {
		seen = { url, opts }
		return { ok: true, status: 200, text: async () => JSON.stringify({ data: { tokensLib: singleFile() } }) }
	}
	const json = await fetchFromPenpot({ url: 'https://penpot.example/', fileId: 'abc', token: 'secret', fetchImpl })
	assert.equal(seen.url, 'https://penpot.example/api/rpc/command/get-file?id=abc')
	assert.equal(seen.opts.headers.authorization, 'Token secret')
	assert.equal(seen.opts.headers.accept, 'application/json')
	writtenAsCommitted(exportFiles(readPenpot(json)))
})

test('the RPC fetch explains a missing token and a refusal', async () => {
	await assert.rejects(fetchFromPenpot({ token: '' }), /PENPOT_ACCESS_TOKEN is not set/)
	const fetchImpl = async () => ({ ok: false, status: 401, text: async () => '{"type":"authentication"}' })
	await assert.rejects(fetchFromPenpot({ token: 't', fetchImpl }), /answered 401/)
})

test('a file with no token library is an error, not an empty pull', () => {
	assert.throws(() => readPenpot({ data: { pages: [] } }), /no design tokens/)
})

test('the plugin snippet reads token.value, not resolvedValue', () => {
	assert.match(PLUGIN_DUMP, /value: k\.value/)
	assert.doesNotMatch(PLUGIN_DUMP, /resolvedValue/)
})
