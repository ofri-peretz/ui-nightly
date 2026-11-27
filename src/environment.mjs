// What the page was rendered from, besides its own code: the font files it loaded. A baseline is only
// comparable with a screenshot made from the same bytes. A font fetched at build time (next/font/google,
// a Google Fonts <link>) can change between two builds of the same commit and move text by a pixel, and
// that looks exactly like a regression. Each shot records a digest of its font files; the baselines
// branch keeps the digest of the run that made each baseline (environment.json); the report names the
// font files that changed when failing shots no longer load what their baseline loaded.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { writeFile } from './util.mjs';

export const ENVIRONMENT_FILE = 'environment.json';

const sha = (buf, n) => createHash('sha1').update(buf).digest('hex').slice(0, n);

/** `name:digest` for each font file one page load fetched, sorted. */
export function fontEntries(files) {
  return [...new Set(files.map(({ url, body }) => `${basename(new URL(url).pathname)}:${sha(body, 10)}`))].sort();
}

/** A short id for a set of entries; the same files always give the same id. */
export const fontSetId = (entries) => sha(entries.join('\n'), 12);

export function emptyEnvironment() { return { version: 1, fontSets: {}, shots: {} }; }

export function readEnvironment(dir) {
  const f = dir && join(dir, ENVIRONMENT_FILE);
  if (!f || !existsSync(f)) return emptyEnvironment();
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    return { version: 1, fontSets: j.fontSets ?? {}, shots: j.shots ?? {} };
  } catch { return emptyEnvironment(); }
}

/** Record the font set of a shot as the one its baseline was made with. */
export function recordShot(env, rel, setId, entries) {
  if (!setId) return false;
  const changed = env.shots[rel] !== setId;
  env.shots[rel] = setId;
  env.fontSets[setId] = entries;
  return changed;
}

export function forgetShot(env, rel) { delete env.shots[rel]; }

/** Drop font sets no shot refers to, then write the file when it differs from what is on disk. */
export function writeEnvironment(dir, env) {
  const used = new Set(Object.values(env.shots));
  for (const id of Object.keys(env.fontSets)) if (!used.has(id)) delete env.fontSets[id];
  const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  const text = `${JSON.stringify({ version: 1, fontSets: sorted(env.fontSets), shots: sorted(env.shots) }, null, 1)}\n`;
  const f = join(dir, ENVIRONMENT_FILE);
  if (existsSync(f) && readFileSync(f, 'utf8') === text) return false;
  writeFile(f, text);
  return true;
}

/**
 * Failing shots whose font files differ from the ones their baseline was made with.
 * `fontSets` maps a set id to its entries (from the shards' results).
 */
export function fontDrift(failing, fontSets, env) {
  const drifted = [];
  const added = new Set();
  const removed = new Set();
  for (const r of failing) {
    const was = env.shots[r.rel];
    if (!r.fonts || !was || was === r.fonts) continue;
    const before = new Set(env.fontSets[was] ?? []);
    const now = new Set(fontSets[r.fonts] ?? []);
    if (!before.size && !now.size) continue;
    drifted.push(r);
    for (const e of now) if (!before.has(e)) added.add(e);
    for (const e of before) if (!now.has(e)) removed.add(e);
  }
  return { drifted, added: [...added].sort(), removed: [...removed].sort(), failing: failing.length };
}

export function fontDriftMarkdown(d) {
  if (!d.drifted.length) return '';
  const list = (xs) => (xs.length ? xs.slice(0, 12).map((x) => `\`${x}\``).join(', ') + (xs.length > 12 ? `, and ${xs.length - 12} more` : '') : 'none');
  return [
    '### Fonts changed since the baselines', '',
    `${d.drifted.length} of ${d.failing} failing screenshots loaded different font files than the run that made their baselines. `
    + 'That alone moves text by a pixel and fails a screenshot, whatever the code did.', '',
    `- Font files no longer loaded: ${list(d.removed)}`,
    `- Font files loaded now: ${list(d.added)}`, '',
    'A font fetched at build time (`next/font/google`, a Google Fonts `<link>`) can change between two builds of the same commit. '
    + 'Commit the font files, so every night renders the same bytes, then accept the new baselines once.', '',
  ].join('\n');
}
