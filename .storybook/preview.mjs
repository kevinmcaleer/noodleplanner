// Token order matches templates/index.html's <link> order: base.css defines
// the raw palette primitives, dark-mode.css and visual-system.css layer
// semantic --np-* tokens on top of them (see docs/design/consolidation-and-handoff.md
// for why both currently define overlapping token names).
import '../packages/noodle-web/src/noodle_web/static/base.css';
import '../packages/noodle-web/src/noodle_web/static/dark-mode.css';
import '../packages/noodle-web/src/noodle_web/static/visual-system.css';
import './preview.css';

/** @type {import('@storybook/web-components-vite').Preview} */
const preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  globalTypes: {
    theme: {
      description: 'NoodlePlanner theme',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: 'light',
  },
  decorators: [
    (story, context) => {
      document.documentElement.setAttribute('data-theme', context.globals.theme || 'light');
      return story();
    },
  ],
};

export default preview;
