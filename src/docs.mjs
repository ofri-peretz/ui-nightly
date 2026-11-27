// One description per config key. The README reference table and schema.json are generated from this
// and from DEFAULTS (scripts/gen-docs.mjs); a test fails if either is stale or a key has no description.
import { DEFAULTS, VIEWPORT_OPTION_KEYS, VARIANT_OPTION_KEYS, OVERRIDE_OPTION_KEYS } from './config.mjs';

export const DESCRIPTIONS = {
  'storybook': 'Where the built Storybook is and which stories to check.',
  'storybook.dir': 'Directory of a built static Storybook (the output of `storybook build`). It must contain `index.json` or `stories.json`.',
  'storybook.include': 'Patterns (`*` wildcard, case-insensitive) matched against story id, title and `title/name`. Empty means every story.',
  'storybook.exclude': 'Same patterns; a match removes the story.',
  'storybook.skipTags': 'Stories carrying any of these tags are skipped. Tag a story `no-visual` to opt it out.',
  'pages': 'Page URLs to screenshot besides, or instead of, stories.',
  'pages.urls': 'Paths (`/pricing`) or full URLs. Each is captured in every profile.',
  'pages.baseUrl': 'Base for relative `urls` when no server command is set.',
  'pages.server': 'A server the workflow starts for the pages.',
  'pages.server.command': 'Shell command that serves the site, run in the working directory. Empty means none. The capture job needs the project installed: set `capture-install: true`.',
  'pages.server.url': 'URL polled until the server answers. Also the base URL for relative `urls` when a command is set.',
  'pages.server.timeoutSeconds': 'How long to wait for the server before failing.',
  'browsers': 'Engines to run: `chromium`, `firefox`, `webkit`. One matrix leg each.',
  'viewports': 'Named viewports. Merged with the defaults by name; `null` removes a default. Each is `{ "device": "iPhone 13" }` (a Playwright device: size, user agent, touch) or `{ "width", "height" }`.',
  'variants': 'Named reading conditions, merged with the defaults by name; `null` removes one. A profile is every viewport x variant (a variant may limit itself with `viewports`).',
  'capture': 'How a page is rendered and photographed.',
  'capture.fullPage': 'Capture the full scroll height rather than only the viewport.',
  'capture.maxHeight': 'Cap on the captured height in CSS pixels, so an endless page cannot make an endless image.',
  'capture.deviceScaleFactor': 'Pixel density. 1 keeps images small; a viewport can override it with its own `deviceScaleFactor`.',
  'capture.timezone': 'Timezone id, fixed for determinism.',
  'capture.locale': 'Locale, fixed for determinism.',
  'capture.fixedTime': 'ISO time the page clock is fixed to. Empty leaves the real clock.',
  'capture.seedRandom': 'Replace `Math.random` with a seeded generator.',
  'capture.disableAnimations': 'Disable CSS animations and transitions and hide the caret.',
  'capture.reducedMotion': '`prefers-reduced-motion` for every profile (`reduce` or `no-preference`). A variant can override it.',
  'capture.settleMs': 'Pause after the page is ready, before the first frame.',
  'capture.waitForFonts': 'Before the first frame, wait until no font is loading for two frames in a row. `document.fonts.ready` alone can resolve before layout has asked for a font.',
  'capture.loadLazyImages': 'Load `loading="lazy"` images and iframes before the frame and wait until they are decoded. A browser that does not scroll never fetches the ones below the fold; Firefox does not fetch them for a full-page capture.',
  'capture.timeoutMs': 'Per-step timeout: navigation, story render, selector wait, images and fonts settling.',
  'capture.stabilityTries': 'Take frames until two in a row are identical, up to this many. 1 turns the check off.',
  'capture.retries': 'Extra attempts for a mismatching or failing shot. A shot that passes on a retry is reported as flaky, not hidden.',
  'capture.concurrency': 'Pages rendered in parallel within one capture job.',
  'capture.waitForSelector': 'CSS selector that must exist before the frame is taken (for example a skeleton gone).',
  'capture.hideSelectors': 'Selectors hidden with `visibility: hidden` (ads, timestamps, carousels).',
  'capture.css': 'CSS injected into every page before the frame.',
  'compare': 'How a screenshot is compared with its baseline.',
  'compare.threshold': 'Per-pixel perceptual tolerance, 0 (exact) to 1.',
  'compare.maxDiffPixels': 'A shot fails when differing pixels exceed `max(maxDiffPixels, maxDiffPixelRatio x pixels)`.',
  'compare.maxDiffPixelRatio': 'Fraction of pixels allowed to differ. A change of image size always fails.',
  'compare.overrides': 'Per-story tolerances: `[{ "match": "button*", "maxDiffPixelRatio": 0.01 }]`. Later entries win.',
  'shards': 'Capture jobs per browser: a number, or `auto` to size from `shotsPerShard`.',
  'shotsPerShard': 'Target screenshots per capture job when `shards` is `auto`.',
  'changed': 'How `mode: changed` (pull requests) picks stories.',
  'changed.globalPatterns': 'Any changed file matching one of these selects every story (stylesheets, tokens, Storybook config, lockfiles).',
  'changed.siblingDirectory': 'A changed file in the same directory as a story file selects that story. No module graph is built; this is a heuristic.',
  'compat': 'The browserslist CSS compatibility check.',
  'compat.enabled': 'Run the check.',
  'compat.paths': 'Directories or files to scan for CSS (`.css`, and `<style>` in `.html`). Empty means the staged Storybook.',
  'compat.browserslist': 'Queries that replace the project\'s own browserslist config. Empty means use `.browserslistrc` / `package.json`.',
  'compat.fail': '`unsupported` fails when a target lacks a feature that can break the page. `partial` also fails on partial support. `any` also fails on progressive enhancements (`text-wrap: balance`, `scrollbar-width`, view transitions, ...), which are otherwise only reported. `never` only reports.',
  'compat.ignoreFeatures': 'caniuse feature ids to skip, for example `css-has`.',
  'compat.ignoreFiles': 'Patterns (`*` wildcard) of files to skip. Storybook\'s own UI assets are skipped by default.',
};

export const VIEWPORT_DOCS = {
  device: 'A Playwright device name such as `iPhone 13` or `iPad (gen 7)`. Brings the size, user agent, touch and mobile flags.',
  width: 'CSS pixel width (with `height`, instead of `device`; overrides the device).',
  height: 'CSS pixel height.',
  deviceScaleFactor: 'Pixel density for this viewport. Default: `capture.deviceScaleFactor`.',
  isMobile: 'Mobile viewport behaviour. Ignored on Firefox, which does not support it.',
  hasTouch: 'Touch events.',
  browsers: 'Engines this viewport is captured in. Omit for all. Use it to keep Firefox and WebKit to a smaller set.',
};
export const VARIANT_DOCS = {
  colorScheme: '`light` or `dark`: the `prefers-color-scheme` media feature.',
  forcedColors: '`active` emulates forced-colors (Windows high contrast); `none` is off.',
  contrast: '`more` or `no-preference`: the `prefers-contrast` media feature.',
  reducedMotion: '`reduce` or `no-preference` for this variant. Default: `capture.reducedMotion`.',
  zoom: 'Browser zoom factor. 2 is 200%: half the CSS viewport at twice the pixel density.',
  textScale: 'Root `font-size` as a multiple (1.5 is 150% text). Finds fixed-pixel text.',
  globals: 'Storybook globals sent as `&globals=key:value;...`, for example `{ "theme": "dark" }`.',
  htmlAttributes: 'Attributes set on `<html>`, for example `{ "data-theme": "dark" }`.',
  htmlClass: 'Classes added to `<html>`, for example `["dark"]`.',
  css: 'CSS injected for this variant only.',
  viewports: 'Names of the viewports this variant applies to. Omit for all.',
  browsers: 'Engines this variant is captured in. Omit for all.',
};
export const OVERRIDE_DOCS = {
  match: 'Pattern matched against story id, title and `title/name`.',
  threshold: 'Per-pixel tolerance for matching stories.',
  maxDiffPixels: 'Allowed differing pixels for matching stories.',
  maxDiffPixelRatio: 'Allowed fraction of differing pixels for matching stories.',
};

export function schema() {
  const kind = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
  const build = (obj, path) => {
    const props = {};
    for (const [k, v] of Object.entries(obj)) {
      const here = path ? `${path}.${k}` : k;
      const description = DESCRIPTIONS[here];
      if (k === 'viewports') {
        props[k] = { description, type: 'object', default: v, additionalProperties: {
          oneOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, properties: Object.fromEntries(VIEWPORT_OPTION_KEYS.map((x) => [x, { description: VIEWPORT_DOCS[x] }])) }],
        } };
      } else if (k === 'variants') {
        props[k] = { description, type: 'object', default: v, additionalProperties: {
          oneOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, properties: Object.fromEntries(VARIANT_OPTION_KEYS.map((x) => [x, { description: VARIANT_DOCS[x] }])) }],
        } };
      } else if (k === 'overrides') {
        props[k] = { description, type: 'array', default: v, items: { type: 'object', required: ['match'], additionalProperties: false, properties: Object.fromEntries(OVERRIDE_OPTION_KEYS.map((x) => [x, { description: OVERRIDE_DOCS[x] }])) } };
      } else if (k === 'shards') {
        props[k] = { description, default: v, oneOf: [{ const: 'auto' }, { type: 'integer', minimum: 1 }] };
      } else if (kind(v) === 'object') {
        props[k] = { description, type: 'object', additionalProperties: false, properties: build(v, here) };
      } else if (kind(v) === 'array') {
        props[k] = { description, type: 'array', default: v, items: { type: k === 'browsers' ? 'string' : 'string' }, ...(k === 'browsers' ? { items: { enum: ['chromium', 'firefox', 'webkit'] } } : {}) };
      } else {
        props[k] = { description, type: kind(v) === 'number' ? 'number' : kind(v), default: v, ...(k === 'fail' ? { enum: ['unsupported', 'partial', 'any', 'never'] } : {}) };
      }
    }
    return props;
  };
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'ui-nightly configuration',
    type: 'object',
    additionalProperties: false,
    properties: { $schema: { type: 'string' }, ...build(DEFAULTS, '') },
  };
}

const cell = (v) => `\`${JSON.stringify(v)}\``.replace(/\|/g, '\\|');

export function configReferenceMarkdown(allKeys) {
  const rows = ['| Key | Default | What it does |', '| :-- | :-- | :-- |'];
  const get = (path) => path.split('.').reduce((o, k) => o?.[k], DEFAULTS);
  for (const key of allKeys) {
    const v = get(key);
    const isObj = v && typeof v === 'object' && !Array.isArray(v);
    rows.push(`| \`${key}\` | ${isObj ? '' : cell(v)} | ${DESCRIPTIONS[key] ?? ''} |`);
  }
  const sub = (title, docs) => [``, `**${title}**`, '', '| Key | What it does |', '| :-- | :-- |', ...Object.entries(docs).map(([k, d]) => `| \`${k}\` | ${d} |`)];
  return [
    ...rows,
    ...sub('Each entry of `viewports`', VIEWPORT_DOCS),
    ...sub('Each entry of `variants`', VARIANT_DOCS),
    ...sub('Each entry of `compare.overrides`', OVERRIDE_DOCS),
  ].join('\n');
}
