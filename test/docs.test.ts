// Docs point at code by path: every backticked repo path in a tracked Markdown file must still exist, so a rename
// or a removal shows up here instead of leaving a stale pointer.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(__dirname, '..');
const docs = execFileSync('git', ['ls-files', '*.md'], { cwd: raiz, encoding: 'utf8' }).split('\n').filter(Boolean);
// paths under the repo's own folders; placeholders (<id>, *, …, ?query) aren't checked
const PATH = /`((?:server|shared|web|electron|scripts|test|docs|LICENSES|assets\/terceros)\/[^`\s]+)`/g;

describe('docs', () => {
  it('every backticked repo path in tracked Markdown exists', () => {
    const missing = docs.flatMap(f => [...readFileSync(path.join(raiz, f), 'utf8').matchAll(PATH)].map(m => m[1])
      .filter(p => !/[<*…?]/.test(p)).filter(p => !existsSync(path.join(raiz, p.replace(/:\d+$/, '')))).map(p => `${f}: ${p}`));
    expect(missing).toEqual([]);
  });
});
