// Regenerates schema.json and the config reference inside README.md from src/docs.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { schema, configReferenceMarkdown } from '../src/docs.mjs';
import { allKeys } from '../src/config.mjs';

const START = '<!-- config-reference:start -->';
const END = '<!-- config-reference:end -->';

export function render(readme) {
  const a = readme.indexOf(START);
  const b = readme.indexOf(END);
  if (a < 0 || b < 0) throw new Error('README.md is missing the config-reference markers');
  return `${readme.slice(0, a + START.length)}\n\n${configReferenceMarkdown(allKeys())}\n\n${readme.slice(b)}`;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  writeFileSync('schema.json', JSON.stringify(schema(), null, 2) + '\n');
  writeFileSync('README.md', render(readFileSync('README.md', 'utf8')));
  console.log('schema.json and README.md config reference regenerated');
}
