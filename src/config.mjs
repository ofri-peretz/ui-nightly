// Defaults, loading, merging and validation of .ui-nightly.json.
// Zero dependencies: JSON only, so no parser is needed.
import { readFileSync, existsSync } from 'node:fs';

export const DEFAULTS = {
  storybook: {
    // Directory of a built static Storybook (the output of `storybook build`).
    dir: 'storybook-static',
    // Patterns (`*` wildcard) matched against story id and title. Empty include = everything.
    include: [],
    exclude: [],
    // Stories carrying any of these tags are skipped.
    skipTags: ['no-visual'],
  },
  pages: {
    // Paths or full URLs to screenshot besides (or instead of) stories.
    urls: [],
    // Base URL for relative `urls` when no server command is configured.
    baseUrl: '',
    server: {
      // Shell command that serves the site (run in the working directory). Empty = none.
      command: '',
      url: 'http://127.0.0.1:3000',
      timeoutSeconds: 120,
    },
  },
  browsers: ['chromium'],
  viewports: {
    phone: { device: 'iPhone 13' },
    tablet: { device: 'iPad (gen 7)' },
    desktop: { width: 1280, height: 800 },
  },
  variants: {
    light: { colorScheme: 'light' },
    dark: { colorScheme: 'dark', globals: { theme: 'dark' } },
    contrast: { colorScheme: 'light', forcedColors: 'active' },
    zoom200: { colorScheme: 'light', zoom: 2, viewports: ['desktop'] },
    text150: { colorScheme: 'light', textScale: 1.5, viewports: ['phone', 'desktop'] },
  },
  capture: {
    fullPage: true,
    maxHeight: 4000,
    deviceScaleFactor: 1,
    timezone: 'UTC',
    locale: 'en-US',
    fixedTime: '2026-01-01T12:00:00Z',
    seedRandom: true,
    disableAnimations: true,
    reducedMotion: 'reduce',
    settleMs: 100,
    timeoutMs: 30000,
    stabilityTries: 3,
    retries: 2,
    concurrency: 2,
    waitForSelector: '',
    hideSelectors: [],
    css: '',
  },
  compare: {
    // Per-pixel perceptual tolerance, 0 (exact) to 1 (anything).
    threshold: 0.1,
    // A shot fails when differing pixels exceed max(maxDiffPixels, maxDiffPixelRatio * pixels).
    maxDiffPixels: 0,
    maxDiffPixelRatio: 0.0005,
    // [{ match: "button*", maxDiffPixelRatio: 0.01, maxDiffPixels: 0, threshold: 0.2 }]
    overrides: [],
  },
  // A number, or "auto" to size shards from shotsPerShard.
  shards: 'auto',
  shotsPerShard: 400,
  changed: {
    // Any changed file matching one of these selects every story.
    globalPatterns: [
      '*.css', '*.scss', '*.sass', '*.less', '*.pcss', '*tokens*', '*.storybook/*',
      'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
    ],
    // A changed file in the same directory as a story file selects that story.
    siblingDirectory: true,
  },
  compat: {
    enabled: true,
    // Directories or files scanned for CSS. Empty = the Storybook dir (and the page build dirs below).
    paths: [],
    // Overrides the project's browserslist. Empty = use .browserslistrc / package.json.
    browserslist: [],
    // "unsupported" fails on features a target lacks; "partial" also on partial support; "never" only reports.
    fail: 'unsupported',
    ignoreFeatures: [],
    ignoreFiles: ['*/sb-manager/*', '*/sb-addons/*', '*/sb-common-assets/*'],
  },
};

// Maps whose entries are open-ended (user-chosen names).
const OPEN_MAPS = new Set(['viewports', 'variants']);
const VIEWPORT_KEYS = ['device', 'width', 'height', 'deviceScaleFactor', 'isMobile', 'hasTouch', 'browsers'];
const VARIANT_KEYS = [
  'colorScheme', 'forcedColors', 'contrast', 'reducedMotion', 'zoom', 'textScale',
  'globals', 'htmlAttributes', 'htmlClass', 'css', 'viewports', 'browsers',
];
const OVERRIDE_KEYS = ['match', 'threshold', 'maxDiffPixels', 'maxDiffPixelRatio'];

const kind = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

export function validate(user, defaults = DEFAULTS, path = '') {
  const errors = [];
  if (kind(user) !== 'object') return [`${path || 'config'}: expected an object`];
  for (const [key, value] of Object.entries(user)) {
    const here = path ? `${path}.${key}` : key;
    if (key === '$schema' && !path) continue;
    if (OPEN_MAPS.has(path)) {
      if (value === null) continue; // removes a default entry
      const allowed = path === 'viewports' ? VIEWPORT_KEYS : VARIANT_KEYS;
      if (kind(value) !== 'object') { errors.push(`${here}: expected an object or null`); continue; }
      for (const k of Object.keys(value)) {
        if (!allowed.includes(k)) errors.push(`${here}.${k}: unknown key (allowed: ${allowed.join(', ')})`);
      }
      if (path === 'viewports' && !value.device && !(value.width > 0 && value.height > 0)) {
        errors.push(`${here}: needs "device" or both "width" and "height"`);
      }
      continue;
    }
    if (!(key in defaults)) {
      errors.push(`${here}: unknown key${suggest(key, Object.keys(defaults))}`);
      continue;
    }
    const want = kind(defaults[key]);
    const got = kind(value);
    if (key === 'shards') {
      if (!(value === 'auto' || (Number.isInteger(value) && value >= 1))) errors.push(`${here}: expected "auto" or an integer >= 1`);
      continue;
    }
    if (want !== got) { errors.push(`${here}: expected ${want}, got ${got}`); continue; }
    if (want === 'object') errors.push(...validate(value, defaults[key], here));
    if (key === 'overrides') {
      value.forEach((o, i) => {
        for (const k of Object.keys(o)) if (!OVERRIDE_KEYS.includes(k)) errors.push(`${here}[${i}].${k}: unknown key`);
        if (typeof o.match !== 'string') errors.push(`${here}[${i}].match: required string`);
      });
    }
  }
  if (!path) {
    for (const b of user.browsers ?? []) {
      if (!['chromium', 'firefox', 'webkit'].includes(b)) errors.push(`browsers: unknown browser "${b}"`);
    }
    const fail = user.compat?.fail;
    if (fail !== undefined && !['unsupported', 'partial', 'any', 'never'].includes(fail)) {
      errors.push('compat.fail: expected "unsupported", "partial", "any" or "never"');
    }
    const th = user.compare?.threshold;
    if (th !== undefined && !(th >= 0 && th <= 1)) errors.push('compare.threshold: expected 0..1');
    for (const [name, v] of Object.entries(user.variants ?? {})) {
      if (v?.contrast !== undefined && !['more', 'no-preference'].includes(v.contrast)) errors.push(`variants.${name}.contrast: expected "more" or "no-preference"`);
      if (v?.colorScheme !== undefined && !['light', 'dark'].includes(v.colorScheme)) errors.push(`variants.${name}.colorScheme: expected "light" or "dark"`);
      if (v && v.zoom !== undefined && !(v.zoom > 0)) errors.push(`variants.${name}.zoom: expected a number > 0`);
    }
  }
  return errors;
}

function suggest(key, options) {
  const best = options
    .map((o) => [o, distance(key.toLowerCase(), o.toLowerCase())])
    .sort((a, b) => a[1] - b[1])[0];
  return best && best[1] <= 3 ? ` (did you mean "${best[0]}"?)` : ` (allowed: ${options.join(', ')})`;
}

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

export function merge(defaults, user, path = '') {
  if (kind(user) !== 'object') return structuredClone(defaults);
  const out = {};
  const keys = new Set([...Object.keys(defaults), ...Object.keys(user)]);
  for (const key of keys) {
    const here = path ? `${path}.${key}` : key;
    if (key === '$schema') continue;
    if (!(key in user)) { out[key] = structuredClone(defaults[key]); continue; }
    if (OPEN_MAPS.has(path)) {
      if (user[key] !== null) out[key] = user[key]; // a user entry replaces the default of that name
      continue;
    }
    if (OPEN_MAPS.has(key)) {
      out[key] = merge(defaults[key] ?? {}, user[key], key);
      continue;
    }
    if (kind(defaults[key]) === 'object' && kind(user[key]) === 'object') {
      out[key] = merge(defaults[key], user[key], here);
    } else out[key] = user[key];
  }
  return out;
}

export function loadConfig(file = '.ui-nightly.json') {
  let user = {};
  if (file && existsSync(file)) {
    try { user = JSON.parse(readFileSync(file, 'utf8')); }
    catch (e) { throw new ConfigError([`${file}: not valid JSON (${e.message})`]); }
    const errors = validate(user);
    if (errors.length) throw new ConfigError(errors.map((e) => `${file}: ${e}`));
  }
  return merge(DEFAULTS, user);
}

export class ConfigError extends Error {
  constructor(errors) { super(errors.join('\n')); this.errors = errors; }
}

// All dotted keys of the defaults, for the README completeness test.
export function allKeys(obj = DEFAULTS, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const here = prefix ? `${prefix}.${k}` : k;
    keys.push(here);
    if (kind(v) === 'object' && !OPEN_MAPS.has(k)) keys.push(...allKeys(v, here));
  }
  return keys;
}
export const VIEWPORT_OPTION_KEYS = VIEWPORT_KEYS;
export const VARIANT_OPTION_KEYS = VARIANT_KEYS;
export const OVERRIDE_OPTION_KEYS = OVERRIDE_KEYS;
