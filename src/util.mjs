import { mkdirSync, writeFileSync, readdirSync, statSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const log = (...a) => console.error('[ui-nightly]', ...a);

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      const key = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (inline !== undefined) args[key] = inline;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) args[key] = argv[++i];
      else args[key] = true;
    } else args._.push(a);
  }
  return args;
}

export function writeFile(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

export function walk(dir, filter = () => true, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, filter, out);
    else if (filter(p)) out.push(p);
  }
  return out;
}

/** `*` wildcard match, case-insensitive, whole string. */
export function globMatch(pattern, text) {
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
  return re.test(text);
}

export function setOutput(name, value) {
  const f = process.env.GITHUB_OUTPUT;
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  if (f) appendFileSync(f, `${name}=${v}\n`);
  else console.log(`${name}=${v}`);
}

export function slug(s) {
  return s.replace(/^https?:\/\/[^/]+/, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'root';
}
