// End to end on the fixture Storybook, in one real browser. The checks must fail on the unfixed state:
// a deliberate CSS change has to produce a diff, an old browserslist has to produce a compat failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(new URL('../..', import.meta.url).pathname);
const browser = process.env.UI_NIGHTLY_BROWSER ?? 'chromium';
const tmp = mkdtempSync(join(tmpdir(), 'ui-nightly-e2e-'));
const sb = join(tmp, 'storybook');
const work = join(tmp, 'work');
const base = join(tmp, 'baselines');
const cfgFile = join(tmp, 'config.json');
writeFileSync(cfgFile, JSON.stringify({
  browsers: [browser],
  storybook: { include: ['button--primary', 'layout--responsive', 'determinism*'] },
  compat: { browserslist: ['last 2 chrome versions', 'last 2 firefox versions', 'last 2 safari versions'] },
}));

function cli(...args) {
  return spawnSync('node', [join(root, 'src/cli.mjs'), ...args], { encoding: 'utf8', cwd: tmp, env: { ...process.env, GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' } });
}
const common = ['--config', cfgFile, '--work', work];
const capture = () => cli('capture', ...common, '--browser', browser, '--shard', '0', '--shards', '1', '--baselines', base, '--out', join(work, 'r'));
const report = (...extra) => cli('report', ...common, '--results', join(work, 'r'), '--plan', join(work, 'plan.json'), '--out', join(work, 'report'), ...extra);
const results = () => JSON.parse(readFileSync(join(work, 'r', 'results.json'), 'utf8')).results;

test.before(() => { cpSync(join(root, 'fixtures/static-storybook'), sb, { recursive: true }); });
test.after(() => { rmSync(tmp, { recursive: true, force: true }); });

test('plan selects the filtered stories', () => {
  const r = cli('plan', ...common, '--storybook-dir', sb);
  assert.equal(r.status, 0, r.stderr);
  const plan = JSON.parse(readFileSync(join(work, 'plan.json'), 'utf8'));
  assert.deepEqual(plan.entries.map((e) => e.id), ['button--primary', 'determinism--clock-random-motion', 'layout--responsive']);
});

test('bootstrap: every shot is new and is written as a baseline', () => {
  const c = capture();
  assert.equal(c.status, 0, c.stderr);
  assert.ok(results().every((r) => r.status === 'new'));
  const r = report('--write-baselines', base);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(join(base, browser, 'phone', 'dark', 'layout--responsive.png')));
});

test('an unchanged rerun passes every shot (clock, random and motion are deterministic)', () => {
  const c = capture();
  assert.equal(c.status, 0, c.stderr);
  const bad = results().filter((r) => r.status !== 'passed');
  assert.deepEqual(bad.map((r) => `${r.key} ${r.status}`), []);
  assert.equal(report().status, 0);
});

test('a deliberate CSS change fails with a diff image and exit 1', () => {
  const css = join(sb, 'assets/app.css');
  writeFileSync(css, readFileSync(css, 'utf8') + '\n.btn-primary{background:#d1242f!important}\n@media (min-width:600px){.grid{grid-template-columns:1fr!important}}\n');
  assert.equal(cli('plan', ...common, '--storybook-dir', sb).status, 0); // restage the changed build, as the nightly does
  const c = capture();
  assert.equal(c.status, 0, c.stderr);
  const failed = results().filter((r) => r.status === 'failed');
  assert.ok(failed.length > 0, 'expected failures');
  assert.ok(failed.some((r) => r.id === 'button--primary'));
  assert.ok(failed.some((r) => r.id === 'layout--responsive' && r.viewport !== 'phone'), 'only wider breakpoints change');
  assert.ok(!failed.some((r) => r.id === 'layout--responsive' && r.viewport === 'phone' && r.variant === 'light'), 'phone layout is untouched');
  assert.ok(failed.every((r) => r.expected && existsSync(join(work, 'r', r.expected)) && (r.sizeChanged || (r.diff && existsSync(join(work, 'r', r.diff))))), 'every failure carries its expected image and a diff (or a size change)');
  assert.ok(failed.some((r) => r.diff), 'at least one pixel diff image');
  const r = report();
  assert.equal(r.status, 1);
  assert.ok(existsSync(join(work, 'report', 'report.html')));
  assert.match(readFileSync(join(work, 'report', 'summary.md'), 'utf8'), /Regressions found/);
  assert.equal(report('--no-fail').status, 0);
});

test('an update run that writes baselines accepts the change: it exits 0 and lists what it took', () => {
  // The same diffs fail a normal run (the test above), and a run that only has the update flag but
  // writes nothing (a pull request) must still fail: there is no new baseline to accept.
  assert.equal(report('--update').status, 1, 'update without a write accepts nothing');
  const r = report('--write-baselines', base, '--update');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const summary = readFileSync(join(work, 'report', 'summary.md'), 'utf8');
  assert.match(summary, /Baselines updated/);
  assert.match(summary, /Accepted as the new baseline/);
  assert.doesNotMatch(summary, /### Regressions/);
  const j = JSON.parse(readFileSync(join(work, 'report', 'results.json'), 'utf8'));
  assert.equal(j.regressions, 0);
  assert.ok(j.accepted > 0);
});

test('accepting the change (update) makes the next run green', () => {
  assert.equal(capture().status, 0);
  assert.equal(report().status, 0);
});

test('a missing shard result is a failure, not a silent pass', () => {
  const r = cli('report', ...common, '--results', join(work, 'nothing-here'), '--plan', join(work, 'plan.json'), '--out', join(work, 'report2'));
  assert.equal(r.status, 1);
});

test('compat passes for modern targets and fails for old ones', () => {
  const ok = cli('compat', '--config', cfgFile, '--paths', sb);
  assert.equal(ok.status, 0, ok.stdout);
  const old = join(tmp, 'old.json');
  writeFileSync(old, JSON.stringify({ compat: { browserslist: ['chrome 70', 'safari 12'] } }));
  const bad = cli('compat', '--config', old, '--paths', sb);
  assert.equal(bad.status, 1, bad.stdout);
  assert.match(bad.stdout, /gap in flex layouts|custom properties/);
  const never = join(tmp, 'never.json');
  writeFileSync(never, JSON.stringify({ compat: { browserslist: ['chrome 70'], fail: 'never' } }));
  assert.equal(cli('compat', '--config', never, '--paths', sb).status, 0);
});

test('a misspelled config key fails loudly', () => {
  const f = join(tmp, 'typo.json');
  writeFileSync(f, JSON.stringify({ browsres: ['chromium'] }));
  const r = cli('check-config', '--config', f);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /did you mean "browsers"/);
});
