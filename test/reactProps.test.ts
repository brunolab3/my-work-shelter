// React keeps `key` (and `ref`) for itself: a component that destructures one from its props always gets undefined,
// and tsc doesn't notice. The English-identifiers rename once turned `clave` props into `key` this way.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const web = path.resolve(__dirname, '..', 'web', 'src');
const tsx = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? tsx(path.join(dir, e.name)) : e.name.endsWith('.tsx') ? [path.join(dir, e.name)] : []);

describe('component props', () => {
  it('no component destructures `key` or `ref` from its props', () => {
    const bad: string[] = [];
    for (const f of tsx(web)) {
      // a typed destructured parameter: ({ a, b }: { ... })
      for (const m of readFileSync(f, 'utf8').matchAll(/\(\{([^{}()]*)\}\s*:\s*\{/g)) {
        if (m[1].split(',').some(b => /^\s*(key|ref)\s*($|[:=])/.test(b))) bad.push(`${path.relative(web, f)}: ({${m[1]}})`);
      }
    }
    expect(bad).toEqual([]);
  });
});
