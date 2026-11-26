// browserslist-driven CSS compatibility check.
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { relative } from 'node:path';
import { scanCss, styleBlocks } from './css-scan.mjs';
import { detect, FEATURES } from './features.mjs';

const DEGRADES = new Set(FEATURES.filter((f) => f.degrades).map((f) => f.id));
import { walk, globMatch } from './util.mjs';

const require = createRequire(import.meta.url);

export function resolveTargets(cfg, cwd = process.cwd()) {
  const browserslist = require('browserslist');
  const queries = cfg.compat.browserslist;
  const targets = queries.length ? browserslist(queries) : browserslist(undefined, { path: cwd });
  return { targets, source: queries.length ? 'compat.browserslist' : 'project browserslist config (or defaults)' };
}

const symbolOf = (stat) => (stat ?? 'u')[0];

export function supportTable() {
  const caniuse = require('caniuse-lite');
  const cache = new Map();
  return (id) => {
    if (!cache.has(id)) cache.set(id, caniuse.feature(caniuse.features[id]));
    return cache.get(id);
  };
}

/** For one feature and a list of "agent version" targets: which are unsupported, partial. */
export function evaluate(featureData, targets) {
  const unsupported = [];
  const partial = [];
  for (const t of targets) {
    const sp = t.indexOf(' ');
    const agent = t.slice(0, sp);
    const version = t.slice(sp + 1);
    const stat = featureData.stats[agent]?.[version];
    const s = symbolOf(stat);
    if (s === 'n') unsupported.push(t);
    else if (s === 'a' || s === 'p') partial.push(t);
  }
  return { unsupported, partial };
}

export function collectFiles(paths, ignore = []) {
  const files = [];
  for (const p of paths) {
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) files.push(...walk(p, (f) => /\.(css|html?)$/i.test(f)));
    else files.push(p);
  }
  return files.filter((f) => !ignore.some((g) => globMatch(g, f)));
}

export function scanFiles(files, cwd = process.cwd()) {
  const findings = new Map(); // key: file|feature
  const guarded = new Map();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const blocks = /\.html?$/i.test(file) ? styleBlocks(text) : [{ css: text, offset: 0 }];
    for (const { css, offset } of blocks) {
      for (const node of scanCss(css)) {
        for (const f of detect(node)) {
          const key = `${relative(cwd, file)}|${f.id}`;
          const into = node.guarded ? guarded : findings;
          const cur = into.get(key);
          if (cur) cur.count++;
          else into.set(key, { file: relative(cwd, file), id: f.id, label: f.label, line: node.line + offset, count: 1 });
        }
      }
    }
  }
  return { used: [...findings.values()], guarded: [...guarded.values()] };
}

export function runCompat(cfg, { cwd = process.cwd(), extraPaths = [] } = {}) {
  const { targets, source } = resolveTargets(cfg, cwd);
  const paths = cfg.compat.paths.length ? cfg.compat.paths : extraPaths;
  const files = collectFiles(paths, cfg.compat.ignoreFiles);
  const { used, guarded } = scanFiles(files, cwd);
  const data = supportTable();
  const issues = [];
  for (const u of used) {
    if (cfg.compat.ignoreFeatures.includes(u.id)) continue;
    const { unsupported, partial } = evaluate(data(u.id), targets);
    if (unsupported.length || partial.length) issues.push({ ...u, degrades: Boolean(DEGRADES.has(u.id)), unsupported, partial });
  }
  const mode = cfg.compat.fail;
  const failing = issues.filter((i) => {
    if (i.degrades && mode !== 'any') return false;
    return i.unsupported.length > 0 || ((mode === 'partial' || mode === 'any') && i.partial.length > 0);
  });
  return {
    targets, targetSource: source, filesScanned: files.length,
    featuresUsed: [...new Set(used.map((u) => u.id))].length,
    issues, guarded: guarded.length,
    failed: cfg.compat.fail !== 'never' && failing.length > 0,
  };
}

export function compatMarkdown(r) {
  const lines = ['### CSS compatibility', ''];
  lines.push(`Checked ${r.filesScanned} file(s) against ${r.targets.length} browser target(s) from ${r.targetSource}. ${r.featuresUsed} known feature(s) in use, ${r.guarded} guarded by \`@supports\`.`, '');
  if (!r.issues.length) { lines.push('No CSS the declared targets cannot run.'); return lines.join('\n'); }
  lines.push('| Feature | If missing | File | Unsupported in | Partial in |', '| :-- | :-- | :-- | :-- | :-- |');
  const cut = (a) => (a.length > 6 ? `${a.slice(0, 6).join(', ')} and ${a.length - 6} more` : a.join(', ') || '-');
  for (const i of [...r.issues].sort((a, b) => Number(a.degrades) - Number(b.degrades))) {
    lines.push(`| ${i.label} (\`${i.id}\`) | ${i.degrades ? 'degrades gracefully' : 'can break the page'} | \`${i.file}:${i.line}\`${i.count > 1 ? ` (+${i.count - 1})` : ''} | ${cut(i.unsupported)} | ${cut(i.partial)} |`);
  }
  return lines.join('\n');
}

export const KNOWN_FEATURES = FEATURES.length;
