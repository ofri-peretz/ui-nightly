#!/usr/bin/env node
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig, ConfigError } from './config.mjs';
import { buildPlan, stageStorybook, writePlan } from './plan.mjs';
import { parseArgs, setOutput, writeFile, log } from './util.mjs';

const HELP = `ui-nightly <command> [options]

  check-config  --config .ui-nightly.json
  plan          --config F [--work ui-nightly-out] [--mode full|changed] [--base-ref origin/main] [--storybook-dir D]
  capture       --config F --browser chromium --shard 0 --shards 1 [--work ui-nightly-out] [--baselines DIR] [--out DIR] [--save-all]
  compat        --config F [--out compat.json] [--paths a,b]
  report        --config F --results DIR [--plan plan.json] [--compat compat.json] [--out DIR]
                [--baselines DIR] [--write-baselines DIR] [--update] [--prune] [--run-url URL] [--no-fail]
`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (!cmd || cmd === '--help' || cmd === 'help') { console.log(HELP); return 0; }
  const cfg = loadConfig(args.config ?? '.ui-nightly.json');
  const work = args.work ?? 'ui-nightly-out';

  switch (cmd) {
    case 'check-config': {
      console.log(`config ok: ${Object.keys(cfg.viewports).length} viewports, ${Object.keys(cfg.variants).length} variants, browsers ${cfg.browsers.join(', ')}`);
      return 0;
    }
    case 'plan': {
      const dir = args.storybookDir ?? cfg.storybook.dir;
      const plan = buildPlan(cfg, { storybookDir: dir, mode: args.mode ?? 'full', baseRef: args.baseRef ?? '' });
      writePlan(join(work, 'plan.json'), plan);
      if (existsSync(dir)) stageStorybook(dir, work);
      setOutput('matrix', { include: plan.matrix });
      setOutput('shots', String(plan.shots));
      setOutput('entries', String(plan.entries.length));
      log(`plan: ${plan.entries.length} entries, ${plan.shots} shots, ${plan.matrix.length} capture jobs. ${plan.notes.join(' ')}`);
      return 0;
    }
    case 'capture': {
      const { capture } = await import('./capture.mjs');
      const out = args.out ?? join(work, `results-${args.browser}-${args.shard}`);
      await capture(cfg, {
        plan: join(work, 'plan.json'), browser: args.browser ?? 'chromium', shard: Number(args.shard ?? 0), shards: Number(args.shards ?? 1),
        storybookDir: args.storybookDir ?? join(work, 'storybook'), baselines: args.baselines ?? join(work, 'baselines'),
        out, saveAll: Boolean(args.saveAll), cwd: process.cwd(),
      });
      return 0;
    }
    case 'compat': {
      if (!cfg.compat.enabled) { console.log('compat disabled in config'); return 0; }
      const { runCompat, compatMarkdown } = await import('./compat.mjs');
      const extra = args.paths ? String(args.paths).split(',') : [join(work, 'storybook')];
      const r = runCompat(cfg, { extraPaths: extra });
      if (args.out) writeFile(args.out, JSON.stringify(r, null, 1));
      console.log(compatMarkdown(r));
      setOutput('compat_failed', String(r.failed));
      return r.failed ? 1 : 0;
    }
    case 'report': {
      const { loadResults, summarize, summaryMarkdown, writeReport, writeBaselines } = await import('./report.mjs');
      const plan = args.plan && existsSync(args.plan) ? JSON.parse(readFileSync(args.plan, 'utf8')) : null;
      const compat = args.compat && existsSync(args.compat) ? JSON.parse(readFileSync(args.compat, 'utf8')) : null;
      // An update run that writes baselines accepts the changed screenshots; without a write there
      // is nothing to accept, so a pull-request run with the update flag still reports them.
      const accept = Boolean(args.update && args.writeBaselines);
      const sum = summarize(loadResults(args.results ?? work), plan, { accept });
      // A compat check that was asked for but left no result is a failure, not a pass.
      const compatMissing = Boolean(cfg.compat.enabled && args.compat && !compat);
      const notes = compatMissing ? ['The CSS compatibility check produced no result. Treated as a failure.'] : [];
      const baselinesDir = args.baselines ?? args.writeBaselines;
      const md = summaryMarkdown(sum, { compat, runUrl: args.runUrl, plan, notes, baselines: baselinesDir ? resolve(baselinesDir) : null });
      const out = args.out ?? join(work, 'report');
      writeReport(out, sum, md, compat);
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
      else console.log(md);
      let changes = { added: 0, updated: 0, removed: 0, environment: 0 };
      if (args.writeBaselines) changes = writeBaselines(sum, resolve(args.writeBaselines), { update: Boolean(args.update), prune: Boolean(args.prune) });
      setOutput('regressions', String(sum.regressions));
      setOutput('accepted', String(sum.accepted));
      const bad = sum.failed || Boolean(compat?.failed) || compatMissing;
      setOutput('failed', String(bad));
      setOutput('baseline_changes', String(changes.added + changes.updated + changes.removed + changes.environment));
      log(`baselines: +${changes.added} ~${changes.updated} -${changes.removed}${changes.environment ? ' (font record changed)' : ''}`);
      return bad && !args.noFail ? 1 : 0;
    }
    default:
      console.error(`unknown command "${cmd}"\n${HELP}`);
      return 2;
  }
}

main().then((code) => { process.exitCode = code; }, (e) => {
  if (e instanceof ConfigError) console.error(`config error:\n  ${e.errors.join('\n  ')}`);
  else console.error(`ui-nightly: ${e.stack ?? e}`);
  process.exitCode = 2;
});
