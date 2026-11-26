// Merge shard results into a summary, an HTML report, results.json and (optionally) baseline updates.
import { readFileSync, existsSync, copyFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { walk, writeFile } from './util.mjs';
import { compatMarkdown } from './compat.mjs';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STATUSES = ['passed', 'new', 'flaky', 'failed', 'error'];

export function loadResults(dir) {
  const files = walk(dir, (f) => f.endsWith('results.json') && !f.endsWith('report/results.json'));
  const shards = [];
  for (const f of files) {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    if (!Array.isArray(j.results)) continue;
    shards.push({ ...j, dir: dirname(f) });
  }
  return shards;
}

export function summarize(shards, plan) {
  const all = shards.flatMap((s) => s.results.map((r) => ({ ...r, _dir: s.dir })));
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const r of all) counts[r.status]++;
  const expected = plan?.shots ?? null;
  const missing = expected === null ? 0 : Math.max(0, expected - all.length);
  const expectedShards = plan?.matrix?.length ?? null;
  const missingShards = expectedShards === null ? 0 : Math.max(0, expectedShards - shards.length);
  const seconds = shards.reduce((a, s) => a + s.seconds, 0);
  const regressions = counts.failed + counts.error;
  return {
    total: all.length, expected, missing, missingShards, counts, regressions, seconds: Number(seconds.toFixed(1)),
    unstable: all.filter((r) => r.unstable).length, all,
    failed: regressions > 0 || missing > 0 || missingShards > 0,
  };
}

function cell(rs) {
  if (!rs.length) return '-';
  const bad = rs.filter((r) => r.status === 'failed' || r.status === 'error');
  if (bad.length) return `**${bad.length} diff**`;
  const flaky = rs.filter((r) => r.status === 'flaky').length;
  const fresh = rs.filter((r) => r.status === 'new').length;
  if (flaky) return `${flaky} flaky`;
  if (fresh) return `${fresh} new`;
  return 'ok';
}

export function summaryMarkdown(sum, { compat, runUrl, plan, notes = [] } = {}) {
  const c = sum.counts;
  const out = [];
  const verdict = sum.failed || compat?.failed || notes.length ? 'Regressions found' : 'No regressions';
  out.push(`## UI nightly: ${verdict}`, '');
  out.push(`${sum.total} screenshots in ${sum.seconds}s of runner time: ${c.passed} passed, ${c.failed} failed, ${c.error} errors, ${c.flaky} flaky, ${c.new} new.`);
  if (sum.missing || sum.missingShards) out.push('', `**${sum.missingShards} shard(s) produced no results (${sum.missing} screenshots missing).** Treated as a failure: a green run must account for every screenshot.`);
  if (sum.unstable) out.push('', `${sum.unstable} screenshot(s) never settled (two identical frames in a row); they are marked unstable in results.json.`);
  for (const n of [...(plan?.notes ?? []), ...notes]) out.push('', `_${n}_`);
  if (runUrl) out.push('', `[Full report and images](${runUrl})`);
  out.push('');

  const browsers = [...new Set(sum.all.map((r) => r.browser))].sort();
  const viewports = [...new Set(sum.all.map((r) => r.viewport))];
  for (const b of browsers) {
    const rs = sum.all.filter((r) => r.browser === b);
    out.push(`### ${b}`, '', `| Component | ${viewports.join(' | ')} |`, `| :-- | ${viewports.map(() => ':--').join(' | ')} |`);
    const groups = [...new Set(rs.map((r) => r.title))].sort();
    const shown = groups.slice(0, 80);
    for (const g of shown) {
      out.push(`| ${g} | ${viewports.map((v) => cell(rs.filter((r) => r.title === g && r.viewport === v))).join(' | ')} |`);
    }
    if (groups.length > shown.length) out.push(`| _${groups.length - shown.length} more components, all in results.json_ | ${viewports.map(() => '').join(' | ')} |`);
    out.push('');
  }

  const bad = sum.all.filter((r) => r.status === 'failed' || r.status === 'error');
  if (bad.length) {
    out.push('### Regressions', '', '| Story | Browser | Viewport | Variant | Result |', '| :-- | :-- | :-- | :-- | :-- |');
    for (const r of bad.slice(0, 100)) {
      const what = r.status === 'error' ? `error: ${r.error}` : r.sizeChanged
        ? `size ${r.expectedSize.width}x${r.expectedSize.height} to ${r.width}x${r.height}`
        : `${r.diffPixels} px (${(r.ratio * 100).toFixed(2)}%)`;
      out.push(`| ${r.title} / ${r.name} | ${r.browser} | ${r.viewport} | ${r.variant} | ${what.replace(/\|/g, '/')} |`);
    }
    if (bad.length > 100) out.push('', `_and ${bad.length - 100} more in results.json_`);
    out.push('');
  }
  const flaky = sum.all.filter((r) => r.status === 'flaky');
  if (flaky.length) {
    out.push('### Flaky (passed after a retry, reported not hidden)', '', '| Story | Browser | Profile | Attempts |', '| :-- | :-- | :-- | :-- |');
    for (const r of flaky.slice(0, 50)) out.push(`| ${r.title} / ${r.name} | ${r.browser} | ${r.viewport}/${r.variant} | ${r.attempts} |`);
    out.push('');
  }
  if (compat) out.push(compatMarkdown(compat), '');
  return out.join('\n');
}

const imgTag = (dir, rel, label, budget) => {
  if (!rel) return '';
  const p = join(dir, rel);
  if (!existsSync(p)) return '';
  const buf = readFileSync(p);
  if (budget.left > buf.length) {
    budget.left -= buf.length;
    return `<figure><figcaption>${label}</figcaption><img alt="${label} screenshot" src="data:image/png;base64,${buf.toString('base64')}"></figure>`;
  }
  return `<figure><figcaption>${label}</figcaption><p>Image omitted from this page (size cap); see <code>${esc(rel)}</code> in the artifact.</p></figure>`;
};

export function reportHtml(sum, markdown, compat) {
  const budget = { left: 24 * 1024 * 1024 };
  const notable = sum.all.filter((r) => ['failed', 'error', 'flaky'].includes(r.status));
  const items = notable.slice(0, 200).map((r) => {
    const detail = r.status === 'error' ? esc(r.error) : r.sizeChanged ? 'Size changed' : `${r.diffPixels} differing pixels (${(r.ratio * 100).toFixed(3)}%)`;
    return `<details${r.status === 'failed' ? ' open' : ''}><summary><strong>${esc(r.title)} / ${esc(r.name)}</strong> &middot; ${esc(r.browser)} &middot; ${esc(r.viewport)}/${esc(r.variant)} &middot; <span class="s-${r.status}">${r.status}</span></summary>
<p>${detail}. Attempts: ${r.attempts}.</p><div class="row">${imgTag(r._dir, r.expected, 'Expected', budget)}${imgTag(r._dir, r.actual, 'Actual', budget)}${imgTag(r._dir, r.diff, 'Difference', budget)}</div></details>`;
  }).join('\n');
  const body = esc(markdown);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>UI nightly report</title>
<style>:root{color-scheme:light dark;--bg:#fff;--fg:#1b1f24;--mut:#59636e;--bd:#d0d7de;--bad:#cf222e;--warn:#9a6700}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--bd:#30363d;--bad:#ff7b72;--warn:#d29922}}
body{background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;max-width:72rem;margin:0 auto;padding:1rem 16px}
details{border:1px solid var(--bd);border-radius:6px;padding:.5rem .75rem;margin:.75rem 0}summary{cursor:pointer}
.row{display:flex;flex-wrap:wrap;gap:12px}figure{margin:0;flex:1 1 18rem;min-width:0}figcaption{color:var(--mut);font-size:.875rem}
img{max-width:100%;height:auto;border:1px solid var(--bd)}pre{overflow:auto;white-space:pre-wrap;border:1px solid var(--bd);padding:.75rem;border-radius:6px}
.s-failed,.s-error{color:var(--bad);font-weight:600}.s-flaky{color:var(--warn);font-weight:600}</style></head><body>
<h1>UI nightly report</h1>
<p>${sum.failed ? 'Regressions found.' : 'No regressions.'} ${sum.total} screenshots. ${sum.counts.failed} failed, ${sum.counts.error} errors, ${sum.counts.flaky} flaky, ${sum.counts.new} new.</p>
<h2>Differences</h2>${items || '<p>None.</p>'}
${notable.length > 200 ? `<p>${notable.length - 200} more in results.json.</p>` : ''}
<h2>Summary</h2><pre>${body}</pre>
${compat ? `<h2>Compatibility</h2><pre>${esc(compatMarkdown(compat))}</pre>` : ''}
</body></html>`;
}

export function writeReport(outDir, sum, markdown, compat) {
  writeFile(join(outDir, 'summary.md'), markdown);
  writeFile(join(outDir, 'report.html'), reportHtml(sum, markdown, compat));
  const slim = sum.all.map(({ _dir, ...r }) => r);
  writeFile(join(outDir, 'results.json'), JSON.stringify({ ...sum, all: undefined, results: slim, compat }, null, 1));
  // Carry the images that matter next to the report.
  for (const r of sum.all) {
    for (const k of ['expected', 'actual', 'diff']) {
      if (r[k] && existsSync(join(r._dir, r[k]))) {
        const dest = join(outDir, 'images', r[k]);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(join(r._dir, r[k]), dest);
      }
    }
  }
}

/** Copy accepted screenshots into a baselines checkout. Returns counts. */
export function writeBaselines(sum, baselinesDir, { update = false, prune = false } = {}) {
  let added = 0, updated = 0, removed = 0;
  for (const r of sum.all) {
    const take = r.status === 'new' || (update && r.status === 'failed');
    if (!take || !r.actual) continue;
    const dest = join(baselinesDir, r.rel);
    const existed = existsSync(dest);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(r._dir, r.actual), dest);
    if (existed) updated++; else added++;
  }
  if (prune) {
    const keep = new Set(sum.all.map((r) => r.rel));
    for (const b of new Set(sum.all.map((r) => r.browser))) {
      for (const f of walk(join(baselinesDir, b), (x) => x.endsWith('.png'))) {
        const rel = f.slice(baselinesDir.length + 1);
        if (!keep.has(rel)) { rmSync(f); removed++; }
      }
    }
  }
  return { added, updated, removed };
}

