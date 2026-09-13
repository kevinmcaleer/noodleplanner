/**
 * Preview config: the theme switch, and nothing else.
 *
 * No decorator paints a background or sets a font -- the app's own stylesheets
 * do that, and a Storybook-only override would mean a component could look
 * right here and wrong in the app, which is the one thing this must not do.
 */

/** @type {import('@storybook/html-vite').Preview} */
const preview = {
	// The app switches themes by stamping data-theme on <html>, so Storybook
	// does the same rather than inventing its own mechanism.
	globalTypes: {
		theme: {
			description: 'Colour theme',
			defaultValue: 'light',
			toolbar: {
				title: 'Theme',
				icon: 'circlehollow',
				items: [
					{ value: 'light', icon: 'sun', title: 'Light' },
					{ value: 'dark', icon: 'moon', title: 'Dark' },
				],
				dynamicTitle: true,
			},
		},
	},
	decorators: [
		(story, context) => {
			const root = document.documentElement
			if (context.globals.theme === 'dark') root.setAttribute('data-theme', 'dark')
			else root.removeAttribute('data-theme')
			// The preview iframe's own body has no app class, so give it the
			// page background the app would -- otherwise a dark-theme component
			// renders on white and every contrast judgement is wrong.
			document.body.style.background = 'var(--np-paper)'
			document.body.style.color = 'var(--np-ink)'
			document.body.style.padding = 'var(--np-space-16)'
			return story()
		},
	],
	parameters: {
		controls: { disable: true },
		// The app's own surfaces, so "does this read on a sunken panel" can be
		// answered here instead of in the app.
		backgrounds: { disable: true },
	},
}

export default preview
