// Render every selected entry in every profile, compare with its baseline, write results.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fontEntries, fontSetId } from './environment.mjs';
import { comparePng, withinTolerance } from './diff.mjs';
import { pickShard, profiles } from './plan.mjs';
import { serveStatic, startCommandServer } from './server.mjs';
import { globMatch, slug, writeFile, log } from './util.mjs';

const require = createRequire(import.meta.url);

const ANIMATION_CSS = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;
animation-iteration-count:1!important;transition-duration:0s!important;transition-delay:0s!important;
scroll-behavior:auto!important;caret-color:transparent!important}`;

const SEED_SCRIPT = `(() => { let a = 0x2f6e2b1; Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0;
let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;

export function contextOptions(browserName, viewport, variant, cfg, devices) {
  const dev = viewport.device ? devices[viewport.device] : null;
  if (viewport.device && !dev) {
    throw new Error(`unknown device "${viewport.device}". Try one of: ${Object.keys(devices).filter((d) => !d.includes('landscape')).slice(0, 12).join(', ')}, ...`);
  }
  const width = viewport.width ?? dev.viewport.width;
  const height = viewport.height ?? dev.viewport.height;
  const zoom = variant.zoom ?? 1;
  const opts = {
    viewport: { width: Math.round(width / zoom), height: Math.round(height / zoom) },
    deviceScaleFactor: (viewport.deviceScaleFactor ?? cfg.capture.deviceScaleFactor) * zoom,
    colorScheme: variant.colorScheme ?? 'light',
    reducedMotion: variant.reducedMotion ?? cfg.capture.reducedMotion,
    forcedColors: variant.forcedColors ?? 'none',
    locale: cfg.capture.locale,
    timezoneId: cfg.capture.timezone,
  };
  if (variant.contrast) opts.contrast = variant.contrast;
  const ua = dev?.userAgent;
  if (ua) opts.userAgent = ua;
  const touch = viewport.hasTouch ?? dev?.hasTouch;
  if (touch) opts.hasTouch = true;
  const mobile = viewport.isMobile ?? dev?.isMobile;
  if (mobile && browserName !== 'firefox') opts.isMobile = true; // Firefox rejects isMobile
  return opts;
}

export function storyUrl(base, entry, variant) {
  const params = new URLSearchParams({ id: entry.id, viewMode: 'story' });
  const g = Object.entries(variant.globals ?? {}).map(([k, v]) => `${k}:${v}`).join(';');
  if (g) params.set('globals', g);
  return `${base}/iframe.html?${params}`;
}

export function overridesFor(entry, cfg) {
  const out = { threshold: cfg.compare.threshold, maxDiffPixels: cfg.compare.maxDiffPixels, maxDiffPixelRatio: cfg.compare.maxDiffPixelRatio };
  for (const o of cfg.compare.overrides) {
    if ([entry.id, entry.title, `${entry.title}/${entry.name}`].some((n) => globMatch(o.match, n))) {
      for (const k of ['threshold', 'maxDiffPixels', 'maxDiffPixelRatio']) if (o[k] !== undefined) out[k] = o[k];
    }
  }
  return out;
}

// Everything the frame depends on that the browser loads by itself: images (a lazy one below the fold
// is never fetched by a browser that does not scroll, and waiting for it would wait for ever), and fonts
// (document.fonts.ready can resolve before layout has asked for the font, so ask again until two frames
// in a row have nothing loading). Every wait is bounded; an image that does not arrive fails the shot
// with its address instead of hanging the job.
async function settle(page, c) {
  const left = await page.evaluate(async ({ lazy, fonts, ms }) => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const until = Date.now() + ms;
    const within = (p) => Promise.race([p, new Promise((r) => setTimeout(r, Math.max(0, until - Date.now())))]);
    if (lazy) for (const el of document.querySelectorAll('img[loading="lazy"], iframe[loading="lazy"]')) el.loading = 'eager';
    await within(document.fonts.ready);
    const waiting = [...document.images].filter((i) => !i.complete);
    await within(Promise.all(waiting.map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }))));
    if (lazy) await within(Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
    if (fonts) {
      for (let quiet = 0; quiet < 2 && Date.now() < until;) {
        await within(document.fonts.ready);
        await frame();
        if ([...document.fonts].some((f) => f.status === 'loading')) quiet = 0; else quiet++;
      }
    }
    return [...document.images].filter((i) => !i.complete).map((i) => i.currentSrc || i.src).slice(0, 3);
  }, { lazy: c.loadLazyImages, fonts: c.waitForFonts, ms: c.timeoutMs });
  if (left.length) throw new Error(`images still loading after ${c.timeoutMs} ms: ${left.join(', ')}`);
}

async function prepare(page, entry, variant, cfg) {
  const c = cfg.capture;
  if (entry.kind === 'story') {
    await page.waitForFunction(() => /sb-show-(main|errordisplay|nopreview)/.test(document.body.className), null, { timeout: c.timeoutMs });
    const state = await page.evaluate(() => document.body.className);
    if (state.includes('sb-show-errordisplay')) {
      const msg = await page.evaluate(() => document.querySelector('#error-message')?.textContent?.trim() ?? 'story failed to render');
      throw new Error(`story error: ${msg.slice(0, 300)}`);
    }
    if (state.includes('sb-show-nopreview')) throw new Error('story not found in this Storybook');
  } else {
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }
  if (c.waitForSelector) await page.waitForSelector(c.waitForSelector, { timeout: c.timeoutMs });
  await page.evaluate(({ attrs, classes }) => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(attrs)) root.setAttribute(k, v);
    for (const cl of classes) root.classList.add(cl);
  }, { attrs: variant.htmlAttributes ?? {}, classes: variant.htmlClass ?? [] });
  const css = [
    c.disableAnimations ? ANIMATION_CSS : '',
    variant.textScale && variant.textScale !== 1 ? `html{font-size:${variant.textScale * 100}%!important}` : '',
    c.hideSelectors.length ? `${c.hideSelectors.join(',')}{visibility:hidden!important}` : '',
    c.css, variant.css ?? '',
  ].filter(Boolean).join('\n');
  if (css) await page.addStyleTag({ content: css });
  await settle(page, c);
  if (c.settleMs) await page.waitForTimeout(c.settleMs);
}

async function shoot(page, cfg) {
  const c = cfg.capture;
  const opts = { type: 'png', animations: c.disableAnimations ? 'disabled' : 'allow', caret: 'hide' };
  if (!c.fullPage) return page.screenshot(opts);
  const { h, w } = await page.evaluate(() => ({
    h: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
    w: document.documentElement.clientWidth,
  }));
  if (h > c.maxHeight) return page.screenshot({ ...opts, fullPage: true, clip: { x: 0, y: 0, width: w, height: c.maxHeight } });
  return page.screenshot({ ...opts, fullPage: true });
}

async function attempt(browser, shot, cfg, ctxOpts, url) {
  const context = await browser.newContext(ctxOpts);
  try {
    if (cfg.capture.seedRandom) await context.addInitScript(SEED_SCRIPT);
    const page = await context.newPage();
    const fontFiles = [];
    const fontReads = [];
    page.on('response', (res) => {
      if (res.request().resourceType() !== 'font') return;
      fontReads.push(res.body().then((body) => fontFiles.push({ url: res.url(), body }), () => {}));
    });
    if (cfg.capture.fixedTime) await page.clock.setFixedTime(new Date(cfg.capture.fixedTime));
    page.setDefaultTimeout(cfg.capture.timeoutMs);
    await page.goto(url, { waitUntil: 'load', timeout: cfg.capture.timeoutMs });
    await prepare(page, shot.entry, shot.variantCfg, cfg);
    let prev = await shoot(page, cfg);
    let stable = false;
    for (let i = 1; i < cfg.capture.stabilityTries; i++) {
      await page.waitForTimeout(60);
      const next = await shoot(page, cfg);
      if (next.equals(prev)) { stable = true; prev = next; break; }
      prev = next;
    }
    if (cfg.capture.stabilityTries <= 1) stable = true;
    await Promise.all(fontReads);
    const fonts = fontEntries(fontFiles);
    return { buf: prev, unstable: !stable, fonts };
  } finally {
    await context.close();
  }
}

async function runShot(browser, shot, cfg, io, devices, bases) {
  const started = Date.now();
  const tol = overridesFor(shot.entry, cfg);
  const ctxOpts = contextOptions(shot.browser, shot.viewportCfg, shot.variantCfg, cfg, devices);
  const url = shot.entry.kind === 'story'
    ? storyUrl(bases.storybook, shot.entry, shot.variantCfg)
    : new URL(shot.entry.url, `${bases.pages}/`).href;
  const rel = `${shot.browser}/${shot.viewport}/${shot.variant}/${slug(shot.entry.id)}.png`;
  const baselinePath = join(io.baselines, rel);
  const baseline = existsSync(baselinePath) ? readFileSync(baselinePath) : null;
  const result = {
    key: `${shot.browser}/${shot.viewport}/${shot.variant}/${shot.entry.id}`, rel, id: shot.entry.id, title: shot.entry.title,
    name: shot.entry.name, kind: shot.entry.kind, browser: shot.browser, viewport: shot.viewport, variant: shot.variant,
    status: 'error', attempts: 0, unstable: false, diffPixels: 0, ratio: 0, ms: 0,
  };
  let last = null;
  for (let n = 1; n <= cfg.capture.retries + 1; n++) {
    result.attempts = n;
    try {
      const r = await attempt(browser, shot, cfg, ctxOpts, url);
      last = r;
      result.unstable = r.unstable;
      if (r.fonts.length) { result.fonts = fontSetId(r.fonts); io.fontSets[result.fonts] = r.fonts; }
      delete result.error;
      if (!baseline) { result.status = 'new'; break; }
      const cmp = comparePng(baseline, r.buf, { threshold: tol.threshold });
      Object.assign(result, { diffPixels: cmp.diffPixels, ratio: cmp.ratio, sizeChanged: cmp.sizeChanged, width: cmp.width, height: cmp.height, expectedSize: cmp.expected });
      if (withinTolerance(cmp, tol)) { result.status = n === 1 ? 'passed' : 'flaky'; break; }
      result.status = 'failed';
    } catch (e) {
      result.status = 'error';
      result.error = String(e.message ?? e).split('\n')[0].slice(0, 300);
    }
  }
  if (last && (['new', 'failed', 'flaky'].includes(result.status) || io.saveAll)) {
    writeFile(join(io.out, 'actual', rel), last.buf);
    result.actual = `actual/${rel}`;
  }
  if (last && result.status === 'failed' && baseline) {
    const cmp = comparePng(baseline, last.buf, { threshold: tol.threshold, wantImage: true });
    if (cmp.diffPng) { writeFile(join(io.out, 'diff', rel), cmp.diffPng); result.diff = `diff/${rel}`; }
    writeFile(join(io.out, 'expected', rel), baseline);
    result.expected = `expected/${rel}`;
  }
  result.ms = Date.now() - started;
  return result;
}

export async function capture(cfg, opts) {
  const pw = require('playwright-core');
  const { devices } = pw;
  const browserType = pw[opts.browser];
  if (!browserType) throw new Error(`unknown browser "${opts.browser}"`);
  const plan = JSON.parse(readFileSync(opts.plan, 'utf8'));
  const entries = pickShard(plan.entries, opts.shard, opts.shards);
  const profs = profiles(cfg, opts.browser);
  const io = { baselines: opts.baselines, out: opts.out, saveAll: Boolean(opts.saveAll), fontSets: {} };

  const bases = {};
  const closers = [];
  if (entries.some((e) => e.kind === 'story')) {
    const s = await serveStatic(opts.storybookDir);
    bases.storybook = s.url; closers.push(s.close);
  }
  if (entries.some((e) => e.kind === 'page')) {
    const p = cfg.pages;
    if (p.server.command) {
      const s = await startCommandServer(p.server, opts.cwd ?? process.cwd());
      bases.pages = s.url; closers.push(s.close);
    } else bases.pages = (p.baseUrl || p.server.url).replace(/\/$/, '');
  }

  const shots = [];
  for (const entry of entries) {
    for (const pr of profs) {
      shots.push({
        entry, browser: opts.browser, viewport: pr.viewport, variant: pr.variant,
        viewportCfg: { name: pr.viewport, ...cfg.viewports[pr.viewport] }, variantCfg: cfg.variants[pr.variant],
      });
    }
  }
  log(`${opts.browser} shard ${opts.shard + 1}/${opts.shards}: ${entries.length} entries x ${profs.length} profiles = ${shots.length} shots`);

  const t0 = Date.now();
  const launchArgs = opts.browser === 'chromium' ? ['--font-render-hinting=none', '--disable-lcd-text'] : [];
  const results = [];
  let browser;
  try {
    browser = await browserType.launch({ args: launchArgs });
    let next = 0;
    const worker = async () => {
      while (next < shots.length) {
        const shot = shots[next++];
        const r = await runShot(browser, shot, cfg, io, devices, bases);
        results.push(r);
        if (r.status !== 'passed') log(`${r.status.padEnd(6)} ${r.key}${r.error ? ` (${r.error})` : r.diffPixels ? ` (${r.diffPixels} px)` : ''}`);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, cfg.capture.concurrency) }, worker));
  } finally {
    await browser?.close();
    for (const c of closers) await c();
  }
  results.sort((a, b) => a.key.localeCompare(b.key));
  const seconds = (Date.now() - t0) / 1000;
  const out = {
    browser: opts.browser, shard: opts.shard, shards: opts.shards, playwright: require('playwright-core/package.json').version,
    seconds: Number(seconds.toFixed(1)), shots: results.length, fontSets: io.fontSets, results,
  };
  writeFile(join(opts.out, 'results.json'), JSON.stringify(out, null, 1));
  log(`done: ${results.length} shots in ${seconds.toFixed(1)}s (${(results.length / Math.max(seconds, 0.001)).toFixed(1)} shots/s)`);
  return out;
}
