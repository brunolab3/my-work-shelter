import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BlockersPR } from './prBlocks.ts';

describe('bloqueos marcados a mano entre PR', () => {
  it('se guardan, se quitan, sobreviven al reinicio y solo valen URL de PR de GitHub', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bloqueos-'));
    const a = 'https://github.com/o/r/pull/1', b = 'https://github.com/o/web/pull/2', c = 'https://github.com/o/r/pull/3';
    const m = new BlockersPR(dir);
    m.mark(b, a); m.mark(c, a); m.mark(b, a);
    expect(m.mark(c, a, true)).toEqual([{ from: b, by: a }]);
    expect(new BlockersPR(dir).all()).toEqual([{ from: b, by: a }]);
    expect(() => m.mark(a, a)).toThrow();
    expect(() => m.mark('https://evil.example/pull/1', a)).toThrow();
  });
});
