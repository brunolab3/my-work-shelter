import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BlockersPR } from './bloqueosPR.ts';

describe('bloqueos marcados a mano entre PR', () => {
  it('se guardan, se quitan, sobreviven al reinicio y solo valen URL de PR de GitHub', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bloqueos-'));
    const a = 'https://github.com/o/r/pull/1', b = 'https://github.com/o/web/pull/2', c = 'https://github.com/o/r/pull/3';
    const m = new BlockersPR(dir);
    m.marcar(b, a); m.marcar(c, a); m.marcar(b, a);
    expect(m.marcar(c, a, true)).toEqual([{ de: b, por: a }]);
    expect(new BlockersPR(dir).todos()).toEqual([{ de: b, por: a }]);
    expect(() => m.marcar(a, a)).toThrow();
    expect(() => m.marcar('https://evil.example/pull/1', a)).toThrow();
  });
});
