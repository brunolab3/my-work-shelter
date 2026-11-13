// Lo que se carga en cada sesión cuesta contexto en todas (AGENTS.md, «Lean knowledge»): estos topes lo mantienen
// corto. Si una prueba falla, no subas el tope: arréglalo en código, muévelo a docs/mapa.md (se lee cuando hace falta) o
// recórtalo. Lo que sale bajo demanda (la guía de decorados, el resultado de una herramienta) no cuenta.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TEXTS } from '../shared/textos.ts';
import { ANNEX, bridgeAnnex, annexGit } from '../server/anexo.ts';

const raiz = path.resolve(__dirname, '..');
const largo = (k: string) => Math.max(TEXTS[k].es.length, TEXTS[k].en?.length ?? 0);

describe('contexto de cada sesión', () => {
  it('AGENTS.md (todas las sesiones en este repo) cabe en 8 KB: las funciones van en docs/mapa.md', () => {
    expect(Buffer.byteLength(readFileSync(path.join(raiz, 'AGENTS.md'), 'utf8'))).toBeLessThanOrEqual(8000);
    expect(readFileSync(path.join(raiz, 'CLAUDE.md'), 'utf8').trim()).toBe('@AGENTS.md');
  });
  it('el anexo de los habitantes (cada conversación del juego) es corto', () => {
    expect(ANNEX.length).toBeLessThanOrEqual(3600);
    expect(bridgeAnnex().length).toBeLessThanOrEqual(1300);
    expect(annexGit([]).length).toBeLessThanOrEqual(600);
  });
  it('cada descripción de una herramienta del juego (va en el contexto de cada conversación que la tiene) cabe en 800 caracteres', () => {
    const largas = Object.keys(TEXTS).filter(k => k.startsWith('tool.') && /description$/i.test(k) && largo(k) > 800);
    expect(largas).toEqual([]);
  });
});
