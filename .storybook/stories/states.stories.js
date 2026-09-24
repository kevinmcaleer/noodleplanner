/**
 * Every base control in every interactive state, side by side (#1197).
 *
 * The gallery stories in components.stories.js show each component's
 * *variants*. They cannot show :hover or :focus-visible, which no script can
 * put an element into. storybook-addon-pseudo-states gets round that by
 * rewriting every stylesheet so that `.btn-primary:hover` also matches
 * `.btn-primary.pseudo-hover`, and then adding that class to whichever
 * elements `parameters.pseudo` names -- here, the controls in one column.
 *
 * So the Hover column is the app's own :hover rule, not a copy of it: change
 * `.btn-primary:hover` in visual-system.css and this story changes with it.
 * The addon cannot render user-agent pseudo styles, but every control here has
 * an explicit rule, so nothing in the matrix depends on one.
 *
 * Loading and Error are separate stories rather than columns, because the app
 * does not have a loading or an error state *per control*. It has a loading
 * indicator and a handful of error messages, and those are what is shown.
 * There is no invalid-field style at all -- a form field never shows an error
 * state in NoodlePlanner -- and inventing one here would be the story making
 * a design decision rather than recording one.
 */

import '../../packages/noodle-web/src/noodle_web/static/components/button/np-button.js'
import '../../packages/noodle-web/src/noodle_web/static/components/checkbox/np-checkbox.js'

const STATES = [
	{ id: 'default', title: 'Default' },
	{ id: 'hover', title: 'Hover' },
	{ id: 'focus', title: 'Focus (keyboard)' },
	{ id: 'disabled', title: 'Disabled' },
]

const FORCED = {
	hover: ['pseudo-hover-all'],
	focus: ['pseudo-focus-visible-all', 'pseudo-focus-all'],
}

/**
 * One row per control. `html(disabled)` returns the control's markup, so the
 * Disabled column uses the real `disabled` attribute rather than a class.
 */
const CONTROLS = [
	{
		name: 'Primary button',
		html: (d) => `<button class="btn-primary"${d ? ' disabled' : ''}>Save plan</button>`,
	},
	{
		name: 'Secondary button',
		html: (d) => `<button class="btn-secondary"${d ? ' disabled' : ''}>Cancel</button>`,
	},
	{
		name: '<np-button> primary',
		html: (d) => `<np-button variant="primary"${d ? ' disabled' : ''}>Save plan</np-button>`,
	},
	{
		name: '<np-button> danger',
		html: (d) => `<np-button variant="danger"${d ? ' disabled' : ''}>Delete</np-button>`,
	},
	{
		name: 'Text input',
		html: (d) => `<input type="text" aria-label="Task name" value="Draft the schedule"${d ? ' disabled' : ''}>`,
	},
	{
		name: 'Select',
		html: (d) =>
			`<select aria-label="Priority"${d ? ' disabled' : ''}><option>High</option><option>Low</option></select>`,
	},
	{
		name: '<np-checkbox>',
		html: (d) => `<np-checkbox label="Include weekends"${d ? ' disabled' : ''}></np-checkbox>`,
	},
]

function cellStyle(el) {
	el.style.padding = 'var(--np-space-12)'
	el.style.borderBottom = '1px solid var(--np-border)'
	el.style.display = 'flex'
	el.style.alignItems = 'center'
}

function renderMatrix() {
	const table = document.createElement('div')
	table.style.display = 'grid'
	table.style.gridTemplateColumns = `minmax(160px, auto) repeat(${STATES.length}, minmax(160px, 1fr))`
	table.style.background = 'var(--np-surface)'
	table.style.color = 'var(--np-ink)'
	table.style.border = '1px solid var(--np-border)'
	table.style.borderRadius = 'var(--np-radius-lg)'

	const head = (text) => {
		const h = document.createElement('div')
		h.textContent = text
		cellStyle(h)
		h.style.background = 'var(--np-surface-alt)'
		h.style.font = 'var(--np-text-80) var(--np-font-data)'
		h.style.color = 'var(--np-muted)'
		return h
	}

	table.appendChild(head(''))
	for (const s of STATES) table.appendChild(head(s.title))

	for (const control of CONTROLS) {
		const label = head(control.name)
		label.style.background = 'transparent'
		table.appendChild(label)
		for (const s of STATES) {
			const cell = document.createElement('div')
			cellStyle(cell)
			cell.className = `state-${s.id}`
			// The addon's `pseudo` parameter puts `pseudo-hover` on the element
			// it matches, which forces a light-DOM rule (`.btn-primary.pseudo-hover`)
			// but not a web component's: its shadow rules are rewritten to
			// `:host(.pseudo-hover-all) button`, and the host only inherits the
			// `-all` class from an ancestor. So the cell carries that too.
			if (FORCED[s.id]) cell.classList.add(...FORCED[s.id])
			cell.dataset.control = control.name
			cell.innerHTML = control.html(s.id === 'disabled')
			table.appendChild(cell)
		}
	}
	return table
}

function renderList(items) {
	const wrap = document.createElement('div')
	wrap.style.display = 'grid'
	wrap.style.gap = 'var(--np-space-16)'
	for (const { name, html } of items) {
		const figure = document.createElement('figure')
		figure.style.margin = '0'
		const caption = document.createElement('figcaption')
		caption.textContent = name
		caption.style.font = 'var(--np-text-80) var(--np-font-data)'
		caption.style.color = 'var(--np-muted)'
		caption.style.marginBottom = 'var(--np-space-8)'
		const body = document.createElement('div')
		body.style.position = 'relative'
		body.innerHTML = html
		figure.append(caption, body)
		wrap.appendChild(figure)
	}
	return wrap
}

export default {
	title: 'States',
	parameters: {
		docs: {
			description: {
				component:
					'Each base control in each interactive state, forced with ' +
					'storybook-addon-pseudo-states so the Hover and Focus columns are the ' +
					'app’s own :hover and :focus-visible rules. Use the Theme control for dark.',
			},
		},
	},
}

export const Interactive = {
	name: 'Default, hover, focus, disabled',
	render: renderMatrix,
	parameters: {
		pseudo: {
			hover: ['.state-hover > *'],
			focusVisible: ['.state-focus > *'],
			focus: ['.state-focus > *'],
		},
	},
}

export const Loading = {
	render: () =>
		renderList([
			{
				name: 'Context switch (.np-context-loading)',
				html:
					'<div style="height: 120px"><div class="np-context-loading active">' +
					'<div class="np-context-loading-spinner"></div>' +
					'<div class="np-context-loading-text">Loading plan…</div></div></div>',
			},
			{
				name: 'Template list (.templates-loading)',
				html: '<div class="templates-loading">Loading templates…</div>',
			},
		]),
}

export const Errors = {
	name: 'Error',
	render: () =>
		renderList([
			{
				name: 'Connection test (.ai-test-status.ai-test-error)',
				html: '<span class="ai-test-status ai-test-error">Connection failed.</span>',
			},
			{
				name: 'Chat message (.ai-chat-bubble.error)',
				html: '<div class="ai-chat-bubble error">The model did not answer. Try again.</div>',
			},
			{
				name: 'Import result (.message.error)',
				html: '<div class="message error" style="display: block">Could not read the file.</div>',
			},
			{
				name: 'Template list (.templates-error)',
				html: '<div class="templates-error">Could not load templates.</div>',
			},
		]),
}
