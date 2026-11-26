// Turn config + a built Storybook into a plan: which entries, which profiles, which shards.
import { readFileSync, existsSync, cpSync, rmSync } from 'node:fs';
import { join, posix } from 'node:path';
import { execFileSync } from 'node:child_process';
import { globMatch, slug, writeFile } from './util.mjs';

export function readStoryIndex(dir) {
  for (const f of ['index.json', 'stories.json']) {
    const p = join(dir, f);
    if (!existsSync(p)) continue;
    const j = JSON.parse(readFileSync(p, 'utf8'));
    const raw = j.entries ?? j.stories ?? {};
    return Object.values(raw)
      .filter((e) => (e.type ?? 'story') === 'story')
      .map((e) => ({
        id: e.id, title: e.title, name: e.name, importPath: e.importPath ?? '', tags: e.tags ?? [],
      }));
  }
  throw new Error(`no index.json or stories.json in ${dir}: is it a built Storybook?`);
}

export function filterStories(stories, { include = [], exclude = [], skipTags = [] }) {
  return stories.filter((s) => {
    if (s.tags.some((t) => skipTags.includes(t))) return false;
    const names = [s.id, s.title, `${s.title}/${s.name}`];
    if (include.length && !include.some((p) => names.some((n) => globMatch(p, n)))) return false;
    if (exclude.some((p) => names.some((n) => globMatch(p, n)))) return false;
    return true;
  });
}

/** Stories affected by a list of changed files. Heuristic: no module graph. */
export function affectedStories(stories, changedFiles, { globalPatterns = [], siblingDirectory = true } = {}) {
  const files = changedFiles.map((f) => f.replace(/^\.\//, ''));
  const globalHit = files.find((f) => globalPatterns.some((p) => globMatch(p, f) || globMatch(p, posix.basename(f))));
  if (globalHit) return { stories, reason: `global change: ${globalHit}` };
  const changedDirs = new Set(files.map((f) => posix.dirname(f)));
  const picked = stories.filter((s) => {
    const ip = s.importPath.replace(/^\.\//, '');
    if (!ip) return false;
    if (files.includes(ip)) return true;
    return siblingDirectory && changedDirs.has(posix.dirname(ip));
  });
  return { stories: picked, reason: `${files.length} changed file(s), matched by story file or sibling directory` };
}

export function changedFiles(baseRef, cwd = process.cwd()) {
  const out = execFileSync('git', ['diff', '--name-only', `${baseRef}...HEAD`], { cwd, encoding: 'utf8' });
  const root = execFileSync('git', ['rev-parse', '--show-prefix'], { cwd, encoding: 'utf8' }).trim();
  // Paths are repo-relative; story importPaths are relative to the Storybook project, so strip the prefix when inside a subdirectory.
  return out.split('\n').filter(Boolean).map((f) => (root && f.startsWith(root) ? f.slice(root.length) : f));
}

export function resolveViewports(cfg) {
  return Object.entries(cfg.viewports).map(([name, v]) => ({ name, ...v }));
}

/** viewport x variant pairs, honouring each variant's `viewports` filter and the `browsers` filters. */
export function profiles(cfg, browser = null) {
  const out = [];
  const allowed = (o) => !browser || !o.browsers || o.browsers.includes(browser);
  for (const [vname, viewport] of Object.entries(cfg.viewports)) {
    if (!allowed(viewport)) continue;
    for (const [name, variant] of Object.entries(cfg.variants)) {
      if (!allowed(variant)) continue;
      if (variant.viewports && !variant.viewports.includes(vname)) continue;
      out.push({ viewport: vname, variant: name, key: `${vname}/${name}` });
    }
  }
  return out;
}

export function shardCount(cfg, entries, profileCount = profiles(cfg).length) {
  if (cfg.shards !== 'auto') return cfg.shards;
  return Math.max(1, Math.ceil((entries * profileCount) / cfg.shotsPerShard));
}

export function pickShard(entries, shard, shards) {
  return entries.filter((_, i) => i % shards === shard);
}

export function pageEntries(cfg) {
  return cfg.pages.urls.map((u) => ({
    id: `page-${slug(u)}`, title: 'Pages', name: u, url: u, importPath: '', tags: [], kind: 'page',
  }));
}

export function buildPlan(cfg, { storybookDir, mode = 'full', baseRef = '', files } = {}) {
  let stories = [];
  const notes = [];
  if (storybookDir && existsSync(storybookDir)) {
    stories = filterStories(readStoryIndex(storybookDir), cfg.storybook);
    if (mode === 'changed') {
      const list = files ?? changedFiles(baseRef || 'origin/main');
      const r = affectedStories(stories, list, cfg.changed);
      stories = r.stories;
      notes.push(`changed mode: ${r.reason}; ${stories.length} stories selected`);
    }
  } else if (!cfg.pages.urls.length) {
    throw new Error(`storybook dir "${storybookDir}" does not exist and no pages are configured`);
  }
  const entries = [...stories.map((s) => ({ ...s, kind: 'story' })), ...pageEntries(cfg)]
    .sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set();
  for (const e of entries) { if (ids.has(e.id)) throw new Error(`duplicate entry id "${e.id}"`); ids.add(e.id); }
  const matrix = [];
  let shots = 0;
  const perBrowser = {};
  for (const browser of cfg.browsers) {
    const n = profiles(cfg, browser).length;
    perBrowser[browser] = entries.length * n;
    shots += perBrowser[browser];
    if (!entries.length || !n) continue;
    const shards = shardCount(cfg, entries.length, n);
    for (let shard = 0; shard < shards; shard++) matrix.push({ browser, shard, shards });
  }
  return { entries, matrix, shotsPerBrowser: perBrowser, shots, notes, mode };
}

export function stageStorybook(storybookDir, outDir) {
  const dest = join(outDir, 'storybook');
  rmSync(dest, { recursive: true, force: true });
  cpSync(storybookDir, dest, { recursive: true });
  return dest;
}

export function writePlan(path, plan) { writeFile(path, JSON.stringify(plan, null, 2)); }
