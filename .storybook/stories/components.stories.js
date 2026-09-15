/**
 * Stories for NoodlePlanner's components.
 *
 * The variants come from `static/component-gallery.js`, the same module the
 * /components page renders from. One story per *section*, each rendering that
 * section's variants as a labelled grid -- Storybook's CSF reads static named
 * exports, so a story cannot be generated per variant in a loop.
 *
 * That leaves one thing to keep in step by hand: a new section in the spec
 * needs a new export here. `tests/test_storybook_stories.py` fails if one is
 * missing, so it cannot be forgotten silently. Adding a *variant* needs no
 * change at all.
 *
 * The spec is imported by relative path rather than through the /static URL:
 * Vite resolves imports at build time, and staticDirs only affects what is
 * served.
 */

import { GALLERY } from '../../packages/noodle-web/src/noodle_web/static/component-gallery.js'

function section(id) {
	const found = GALLERY.find((s) => s.id === id)
	if (!found) throw new Error(`component-gallery.js has no section "${id}"`)
	return found
}

/** A labelled cell per variant, so states sit side by side rather than stacked. */
function renderSection(id) {
	const spec = section(id)
	const grid = document.createElement('div')
	grid.style.display = 'grid'
	grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(240px, 1fr))'
	grid.style.gap = 'var(--np-space-16)'

	for (const variant of spec.variants) {
		const cell = document.createElement('div')
		cell.style.border = '1px solid var(--np-border)'
		cell.style.borderRadius = 'var(--np-radius-lg)'
		cell.style.background = 'var(--np-surface)'
		cell.style.overflow = 'hidden'

		const label = document.createElement('div')
		label.textContent = variant.name
		label.style.padding = 'var(--np-space-8) var(--np-space-12)'
		label.style.background = 'var(--np-surface-alt)'
		label.style.borderBottom = '1px solid var(--np-border)'
		label.style.font = 'var(--np-text-80) var(--np-font-data)'
		label.style.color = 'var(--np-muted)'

		const body = document.createElement('div')
		body.style.padding = 'var(--np-space-16)'
		body.style.display = 'flex'
		body.style.gap = 'var(--np-space-8)'
		body.style.alignItems = 'center'
		body.style.flexWrap = 'wrap'
		body.style.minHeight = '72px'
		body.innerHTML = variant.html

		cell.appendChild(label)
		cell.appendChild(body)
		grid.appendChild(cell)
	}
	return grid
}

function storyFor(id) {
    const spec = section(id)
    return {
        name: spec.title,
        render: () => renderSection(id),
        parameters: { docs: { description: { story: spec.note ?? '' } } },
    }
}

export default {
	title: 'Components',
	parameters: {
		docs: {
			description: {
				component:
					'Rendered against the app’s real stylesheets in the app’s real load ' +
					'order. Nothing here defines styling of its own, so a component that looks ' +
					'wrong in Storybook looks wrong in NoodlePlanner. Use the Theme control in ' +
					'the toolbar to switch between light and dark; hover and Tab to see :hover ' +
					'and :focus-visible, which cannot be forced from script.',
			},
		},
	},
}

export const Buttons = storyFor('buttons')
export const Badges = storyFor('badges')
export const FormControls = storyFor('inputs')
export const Feedback = storyFor('feedback')
export const DateSuggestions = storyFor('suggestions')
export const Tables = storyFor('tables')
export const Dashboard = storyFor('dashboard')
export const Tasks = storyFor('tasks')
export const Gantt = storyFor('gantt')
export const IconsSprite = storyFor('icons-sprite')
export const IconsBootstrap = storyFor('icons-bootstrap')
export const IconsGlyph = storyFor('icons-glyph')
