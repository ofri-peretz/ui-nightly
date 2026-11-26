import '../src/app.css';

/** @type {import('@storybook/html-vite').Preview} */
export default {
  globalTypes: { theme: { description: 'Theme', toolbar: { items: ['light', 'dark'] } } },
  decorators: [
    (story, context) => {
      document.documentElement.setAttribute('data-theme', context.globals.theme ?? 'light');
      return story();
    },
  ],
  parameters: { layout: 'fullscreen' },
};
