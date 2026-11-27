import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { encodePng, decodePng } from '../src/png.mjs';
import { comparePng, withinTolerance } from '../src/diff.mjs';
import { DEFAULTS, loadConfig, validate, merge, allKeys } from '../src/config.mjs';
import { filterStories, affectedStories, profiles, shardCount, pickShard, buildPlan } from '../src/plan.mjs';
import { scanCss } from '../src/css-scan.mjs';
import { FEATURES, detect } from '../src/features.mjs';
import { evaluate, scanFiles, supportTable } from '../src/compat.mjs';
import { contextOptions, storyUrl, overridesFor } from '../src/capture.mjs';
import { globMatch } from '../src/util.mjs';
import { summarize, summaryMarkdown } from '../src/report.mjs';
import { fontEntries, fontSetId, fontDrift, fontDriftMarkdown, emptyEnvironment, recordShot } from '../src/environment.mjs';

const require = createRequire(import.meta.url);

function solid(w, h, [r, g, b]) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255; }
  return { width: w, height: h, data };
}

test('png round trip', () => {
  const img = solid(7, 5, [10, 20, 30]);
  const back = decodePng(encodePng(img));
  assert.equal(back.width, 7);
  assert.ok(back.data.equals(img.data));
});

test('diff: identical, different, size change, tolerance', () => {
  const a = encodePng(solid(10, 10, [255, 255, 255]));
  assert.equal(comparePng(a, a).diffPixels, 0);
  const img = solid(10, 10, [255, 255, 255]);
  for (let i = 0; i < 3; i++) { img.data[i * 4] = 0; img.data[i * 4 + 1] = 0; img.data[i * 4 + 2] = 0; }
  const r = comparePng(a, encodePng(img), { wantImage: true });
  assert.equal(r.diffPixels, 3);
  assert.ok(r.diffPng.length > 50);
  assert.equal(withinTolerance(r, { maxDiffPixels: 3 }), true);
  assert.equal(withinTolerance(r, { maxDiffPixels: 2 }), false);
  assert.equal(withinTolerance(r, { maxDiffPixelRatio: 0.05 }), true);
  const big = comparePng(a, encodePng(solid(11, 10, [255, 255, 255])));
  assert.equal(big.sizeChanged, true);
  assert.equal(withinTolerance(big, { maxDiffPixelRatio: 1 }), false);
  // below the perceptual threshold is not a difference
  const near = comparePng(a, encodePng(solid(10, 10, [253, 253, 253])), { threshold: 0.1 });
  assert.equal(near.diffPixels, 0);
});

test('config: defaults load, unknown keys and bad types fail with a hint', () => {
  assert.equal(validate({}).length, 0);
  const errs = validate({ browsres: ['chromium'], compare: { treshold: 0.2 }, shards: 0, browsers: ['ie'] });
  assert.ok(errs.some((e) => e.includes('browsres') && e.includes('browsers')));
  assert.ok(errs.some((e) => e.includes('compare.treshold') && e.includes('threshold')));
  assert.ok(errs.some((e) => e.includes('shards')));
  assert.ok(errs.some((e) => e.includes('unknown browser')));
  assert.ok(validate({ viewports: { x: { colour: 1 } } }).length > 0);
  assert.ok(validate({ viewports: { x: { width: 100 } } }).some((e) => e.includes('needs')));
  assert.equal(validate({ viewports: { phone: null } }).length, 0);
});

test('config: maps merge with defaults, null removes, scalars replace', () => {
  const m = merge(DEFAULTS, { viewports: { watch: { width: 200, height: 200 }, tablet: null }, variants: { dark: { colorScheme: 'dark' } }, compare: { threshold: 0.3 } });
  assert.ok(m.viewports.watch && m.viewports.phone && !m.viewports.tablet);
  assert.deepEqual(m.variants.dark, { colorScheme: 'dark' });
  assert.equal(m.compare.threshold, 0.3);
  assert.equal(m.compare.maxDiffPixelRatio, DEFAULTS.compare.maxDiffPixelRatio);
  assert.equal(loadConfig('does-not-exist.json').browsers[0], 'chromium');
});

const STORIES = [
  { id: 'button--primary', title: 'Button', name: 'Primary', importPath: './src/Button/Button.stories.tsx', tags: [] },
  { id: 'button--ghost', title: 'Button', name: 'Ghost', importPath: './src/Button/Button.stories.tsx', tags: ['no-visual'] },
  { id: 'card--default', title: 'Forms/Card', name: 'Default', importPath: './src/Card/Card.stories.tsx', tags: [] },
  { id: 'menu--open', title: 'Menu', name: 'Open', importPath: './src/Menu.stories.tsx', tags: [] },
];

test('plan: include, exclude, skip tags', () => {
  assert.equal(filterStories(STORIES, { skipTags: ['no-visual'] }).length, 3);
  assert.deepEqual(filterStories(STORIES, { include: ['forms/*'] }).map((s) => s.id), ['card--default']);
  assert.deepEqual(filterStories(STORIES, { exclude: ['menu*'], skipTags: [] }).map((s) => s.id), ['button--primary', 'button--ghost', 'card--default']);
});

test('plan: changed mode picks story file, sibling directory, and everything on a global change', () => {
  const opts = { globalPatterns: ['*.css', '*.storybook/*'], siblingDirectory: true };
  assert.deepEqual(affectedStories(STORIES, ['src/Card/Card.tsx'], opts).stories.map((s) => s.id), ['card--default']);
  assert.deepEqual(affectedStories(STORIES, ['src/Menu.stories.tsx'], opts).stories.map((s) => s.id), ['menu--open']);
  assert.equal(affectedStories(STORIES, ['src/theme.css'], opts).stories.length, 4);
  assert.equal(affectedStories(STORIES, ['apps/sb/.storybook/preview.ts'], opts).stories.length, 4);
  assert.equal(affectedStories(STORIES, ['README.md'], opts).stories.length, 0);
  assert.equal(affectedStories(STORIES, ['src/Card/Card.tsx'], { ...opts, siblingDirectory: false }).stories.length, 0);
});

test('plan: profiles honour variant viewport filters; shards cover every entry exactly once', () => {
  const cfg = merge(DEFAULTS, {});
  const p = profiles(cfg);
  assert.equal(p.length, 12);
  assert.ok(p.every((x) => x.variant !== 'zoom200' || x.viewport === 'desktop'));
  const entries = Array.from({ length: 23 }, (_, i) => i);
  const got = [0, 1, 2, 3].flatMap((s) => pickShard(entries, s, 4));
  assert.deepEqual([...got].sort((a, b) => a - b), entries);
  assert.equal(shardCount({ ...cfg, shards: 'auto', shotsPerShard: 100 }, 20), 3);
  assert.equal(shardCount({ ...cfg, shards: 5 }, 1), 5);
});

test('plan: browsers filters shrink the profile set per engine', () => {
  const cfg = merge(DEFAULTS, { browsers: ['chromium', 'webkit'], variants: { contrast: { colorScheme: 'light', browsers: ['chromium'] } }, shards: 'auto', shotsPerShard: 10 });
  assert.equal(profiles(cfg, 'chromium').length, 12);
  assert.equal(profiles(cfg, 'webkit').length, 9);
  const plan = buildPlan(cfg, { storybookDir: 'fixtures/static-storybook' });
  const n = plan.entries.length; // the fixture grows with the checks that need a story
  assert.equal(plan.shotsPerBrowser.chromium, 12 * n);
  assert.equal(plan.shotsPerBrowser.webkit, 9 * n);
  assert.equal(plan.matrix.filter((m) => m.browser === 'chromium').length, Math.ceil(12 * n / 10));
  assert.equal(plan.matrix.filter((m) => m.browser === 'webkit').length, Math.ceil(9 * n / 10));
});

test('plan: builds from the fixture storybook, 3 browsers x shards', () => {
  const cfg = merge(DEFAULTS, { browsers: ['chromium', 'firefox', 'webkit'], shards: 2 });
  const plan = buildPlan(cfg, { storybookDir: 'fixtures/static-storybook' });
  assert.equal(plan.entries.length, 7); // docs entry and no-visual tag are skipped
  assert.equal(plan.matrix.length, 6);
  assert.equal(plan.shots, 7 * 12 * 3);
});

test('capture: device presets, zoom, firefox isMobile, globals url, overrides', async () => {
  const { devices } = require('playwright-core');
  const cfg = merge(DEFAULTS, { compare: { overrides: [{ match: 'button*', maxDiffPixelRatio: 0.2 }] } });
  const phone = contextOptions('chromium', { device: 'iPhone 13' }, { colorScheme: 'dark' }, cfg, devices);
  assert.equal(phone.isMobile, true);
  assert.equal(phone.colorScheme, 'dark');
  assert.equal(contextOptions('firefox', { device: 'iPhone 13' }, {}, cfg, devices).isMobile, undefined);
  const zoom = contextOptions('chromium', { width: 1280, height: 800 }, { zoom: 2 }, cfg, devices);
  assert.deepEqual(zoom.viewport, { width: 640, height: 400 });
  assert.equal(zoom.deviceScaleFactor, 2);
  assert.throws(() => contextOptions('chromium', { device: 'Nokia 3310' }, {}, cfg, devices), /unknown device/);
  assert.match(storyUrl('http://x', { id: 'a--b' }, { globals: { theme: 'dark', dir: 'rtl' } }), /globals=theme%3Adark%3Bdir%3Artl/);
  assert.equal(overridesFor({ id: 'button--primary', title: 'Button', name: 'Primary' }, cfg).maxDiffPixelRatio, 0.2);
  assert.equal(overridesFor({ id: 'card--x', title: 'Card', name: 'X' }, cfg).maxDiffPixelRatio, DEFAULTS.compare.maxDiffPixelRatio);
});

test('css scan: structure, nesting, supports guard, comments and strings', () => {
  const nodes = scanCss(`/* a:has(b){} */ .a{content:"}{"; display:flex; gap:4px; &:hover{color:red}}
    @supports (container-type:inline-size){@container (min-width:300px){.b{color:blue}}}
    @media (width>=600px){.c:has(img){margin-inline:1px}}`);
  const ids = (n) => detect(n).map((f) => f.id);
  const all = nodes.flatMap((n) => ids(n).map((id) => [id, n.guarded]));
  assert.ok(all.some(([id, g]) => id === 'flexbox-gap' && !g));
  assert.ok(all.some(([id, g]) => id === 'css-nesting' && !g));
  assert.ok(all.some(([id, g]) => id === 'css-container-queries' && g), 'container query inside @supports is guarded');
  assert.ok(all.some(([id]) => id === 'css-has'));
  assert.ok(all.some(([id]) => id === 'css-logical-props'));
  assert.ok(all.some(([id]) => id === 'css-media-range-syntax'));
  assert.ok(nodes.every((n) => !n.prelude.startsWith('a:has')), 'comments are ignored');
});

test('compat: every catalogued feature id exists in the installed caniuse-lite', () => {
  const caniuse = require('caniuse-lite');
  const missing = FEATURES.filter((f) => !(f.id in caniuse.features)).map((f) => f.id);
  assert.deepEqual(missing, []);
  assert.equal(new Set(FEATURES.map((f) => f.id)).size, FEATURES.length, 'ids are unique');
});

test('compat: support lookup flags old targets and spares modern ones', () => {
  const data = supportTable();
  const old = evaluate(data('css-container-queries'), ['chrome 80', 'safari 14', 'firefox 90']);
  assert.equal(old.unsupported.length, 3);
  const modern = evaluate(data('css-container-queries'), ['chrome 140', 'firefox 140']);
  assert.equal(modern.unsupported.length + modern.partial.length, 0);
  const r = scanFiles(['fixtures/static-storybook/assets/app.css']);
  assert.ok(r.used.some((u) => u.id === 'flexbox-gap'));
  assert.ok(r.guarded.length >= 0);
});

test('util: glob', () => {
  assert.ok(globMatch('Button*', 'button--primary'));
  assert.ok(!globMatch('card', 'card--x'));
  assert.ok(globMatch('a.b', 'a.b') && !globMatch('a.b', 'axb'));
});

test('README documents every config key', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const missing = allKeys().filter((k) => !readme.includes(`\`${k}\``));
  assert.deepEqual(missing, []);
});

test('generated docs are current: README config reference and schema.json', async () => {
  const { render } = await import('../scripts/gen-docs.mjs');
  const { schema } = await import('../src/docs.mjs');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.equal(render(readme), readme, 'run: node scripts/gen-docs.mjs');
  const onDisk = readFileSync(new URL('../schema.json', import.meta.url), 'utf8');
  assert.equal(onDisk, JSON.stringify(schema(), null, 2) + '\n', 'run: node scripts/gen-docs.mjs');
});

test('examples validate', () => {
  for (const f of ['examples/ui-nightly.json', 'examples/site-pages.json', 'fixtures/storybook-app/.ui-nightly.json']) {
    assert.deepEqual(validate(JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))), [], f);
  }
});

// An update run that writes baselines accepts the changed screenshots; nothing else is excused.
const shot = (status, over = {}) => ({ status, key: `${status}-${over.n ?? 0}`, rel: `chromium/phone/light/${status}.png`, actual: `${status}.png`, title: 'T', name: 'N', browser: 'chromium', viewport: 'phone', variant: 'light', diffPixels: 9, ratio: 0.01, attempts: 1, ...over });
const shard = (...results) => ({ dir: '/tmp/x', seconds: 1, results });

test('a normal run with changed screenshots is red', () => {
  const sum = summarize([shard(shot('passed'), shot('failed'))], null);
  assert.equal(sum.failed, true);
  assert.equal(sum.regressions, 1);
  assert.equal(sum.accepted, 0);
  assert.match(summaryMarkdown(sum), /Regressions found/);
});

test('an update run that writes baselines is green and lists what it accepted', () => {
  const sum = summarize([shard(shot('passed'), shot('failed', { n: 1 }), shot('failed', { n: 2 }))], null, { accept: true });
  assert.equal(sum.failed, false);
  assert.equal(sum.regressions, 0);
  assert.equal(sum.accepted, 2);
  assert.ok(sum.all.filter((r) => r.accepted).every((r) => r.status === 'failed'), 'still writable as baselines');
  const md = summaryMarkdown(sum);
  assert.match(md, /Baselines updated/);
  assert.match(md, /Accepted as the new baseline/);
  assert.doesNotMatch(md, /### Regressions|Regressions found/);
});

test('an update run still fails on what cannot be accepted', () => {
  const error = summarize([shard(shot('error', { actual: undefined, error: 'boom' }), shot('failed', { n: 1 }))], null, { accept: true });
  assert.equal(error.failed, true, 'an error has no screenshot to accept');
  assert.equal(error.regressions, 1);
  const missing = summarize([shard(shot('failed'))], { shots: 3, matrix: [{}, {}] }, { accept: true });
  assert.equal(missing.failed, true, 'missing results and shards stay failures');
  assert.equal(summarize([shard(shot('failed', { actual: undefined }))], null, { accept: true }).failed, true, 'no image, nothing to accept');
});

test('environment: a font set is the same for the same bytes and different for other bytes', () => {
  const a = fontEntries([{ url: 'http://x/_next/static/media/n.woff2', body: Buffer.from('one') }]);
  const again = fontEntries([{ url: 'http://y/other/path/n.woff2', body: Buffer.from('one') }]);
  const b = fontEntries([{ url: 'http://x/_next/static/media/n.woff2', body: Buffer.from('two') }]);
  assert.deepEqual(a, again);
  assert.notDeepEqual(a, b);
  assert.notEqual(fontSetId(a), fontSetId(b));
  assert.equal(fontSetId(a), fontSetId([...a]));
});

test('environment: only failing shots whose baseline loaded other fonts count as drift', () => {
  const env = emptyEnvironment();
  const was = ['n.woff2:aaaaaaaaaa', 'h.woff2:cccccccccc'];
  const now = ['n.woff2:bbbbbbbbbb', 'h.woff2:cccccccccc'];
  recordShot(env, 'a.png', 'S1', was);
  recordShot(env, 'b.png', 'S1', was);
  recordShot(env, 'c.png', 'S1', was);
  const fontSets = { S1: was, S2: now };
  const failing = [
    { rel: 'a.png', fonts: 'S2' }, // drifted
    { rel: 'b.png', fonts: 'S1' }, // same fonts: a real regression
    { rel: 'd.png', fonts: 'S2' }, // no record of its baseline
    { rel: 'c.png' }, // no fonts captured
  ];
  const d = fontDrift(failing, fontSets, env);
  assert.deepEqual(d.drifted.map((r) => r.rel), ['a.png']);
  assert.deepEqual(d.removed, ['n.woff2:aaaaaaaaaa']);
  assert.deepEqual(d.added, ['n.woff2:bbbbbbbbbb']);
  assert.equal(d.failing, 4);
  assert.match(fontDriftMarkdown(d), /1 of 4 failing screenshots loaded different font files/);
  assert.equal(fontDriftMarkdown(fontDrift(failing.slice(1), fontSets, env)), '');
});

test('config: the settling switches are on by default and typed', () => {
  assert.equal(DEFAULTS.capture.waitForFonts, true);
  assert.equal(DEFAULTS.capture.loadLazyImages, true);
  assert.ok(validate({ capture: { waitForFonts: 'yes' } }).length > 0);
  assert.deepEqual(validate({ capture: { waitForFonts: false, loadLazyImages: false } }), []);
});
